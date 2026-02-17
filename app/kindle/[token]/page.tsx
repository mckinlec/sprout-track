import prisma from '../../api/db';
import { validateDeviceToken } from '../../api/utils/auth';
import { formatForResponse } from '../../api/utils/timezone';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

interface KindlePageProps {
    params: Promise<{ token: string }>;
    searchParams: Promise<{ [key: string]: string | undefined }>;
}

export default async function KindlePage({ params, searchParams }: KindlePageProps) {
    const { token } = await params;
    const query = await searchParams;
    const success = query.success;
    const error = query.error;
    const selectedBabyId = query.babyId;

    // Validate device token
    const authResult = await validateDeviceToken(token);

    if (!authResult.authenticated || !authResult.familyId) {
        return (
            <div style={styles.container}>
                <div style={styles.errorPage}>
                    <div style={{ fontSize: '32px', marginBottom: '16px', fontWeight: 'bold', color: '#c62828' }}>ACCESS DENIED</div>
                    <p style={{ color: '#666', fontSize: '18px' }}>{authResult.error || 'Invalid or expired device token'}</p>
                </div>
            </div>
        );
    }

    const { familyId, caretakerId } = authResult;

    // Fetch babies for this family
    const babies = await prisma.baby.findMany({
        where: { familyId, deletedAt: null, inactive: false },
        orderBy: { firstName: 'asc' },
    });

    if (babies.length === 0) {
        return (
            <div style={styles.container}>
                <div style={styles.errorPage}>
                    <div style={{ fontSize: '32px', marginBottom: '16px', fontWeight: 'bold' }}>No Babies Found</div>
                    <p style={{ color: '#666', fontSize: '18px' }}>Add a baby in the main app first.</p>
                </div>
            </div>
        );
    }

    // Select the baby (default to first if not specified or if URL param is invalid)
    const currentBaby = babies.find(b => b.id === selectedBabyId) || babies[0];

    // Fetch recent activity for the selected baby
    const [lastFeed, lastDiaper, activeSleep, medicines] = await Promise.all([
        prisma.feedLog.findFirst({
            where: { babyId: currentBaby.id, familyId, deletedAt: null },
            orderBy: { time: 'desc' },
        }),
        prisma.diaperLog.findFirst({
            where: { babyId: currentBaby.id, familyId, deletedAt: null },
            orderBy: { time: 'desc' },
        }),
        prisma.sleepLog.findFirst({
            where: { babyId: currentBaby.id, familyId, deletedAt: null, endTime: null },
            orderBy: { startTime: 'desc' },
        }),
        prisma.medicine.findMany({
            where: { familyId, active: true, deletedAt: null },
            orderBy: { name: 'asc' },
        }),
    ]);

    // Fetch family settings for default units
    const settings = await prisma.settings.findFirst({
        where: { familyId },
    });

    const defaultUnit = settings?.defaultBottleUnit || 'OZ';

    // Calculate time ago strings
    const now = new Date();
    const feedAgo = lastFeed ? timeAgo(now, lastFeed.time) : null;
    const diaperAgo = lastDiaper ? timeAgo(now, lastDiaper.time) : null;

    // Success messages
    const successMessages: Record<string, string> = {
        feed: 'Feed logged!',
        diaper: 'Diaper logged!',
        'sleep-start': 'Sleep started!',
        'sleep-end': 'Sleep ended!',
        medicine: 'Medicine logged!',
    };

    return (
        <div style={styles.container}>
            {/* Header */}
            <div style={styles.header}>
                <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#2e7d32' }}>Baby Tracker</div>
            </div>

            {/* Baby Selector (if multiple babies) */}
            {babies.length > 1 && (
                <div style={styles.babySelector}>
                    {babies.map(baby => (
                        <a
                            key={baby.id}
                            href={`/kindle/${token}?babyId=${baby.id}`}
                            style={{
                                ...styles.babyTab,
                                ...(baby.id === currentBaby.id ? styles.babyTabActive : {}),
                            }}
                        >
                            {baby.firstName}
                        </a>
                    ))}
                </div>
            )}

            {/* Success / Error Toast */}
            {success && successMessages[success] && (
                <div style={styles.successToast}>{successMessages[success]}</div>
            )}
            {error && (
                <div style={styles.errorToast}>ERROR: {error}</div>
            )}

            {/* Current Baby Name */}
            <div style={{ textAlign: 'center' as const, fontSize: '20px', padding: '8px 0', fontWeight: 'bold', color: '#333' }}>
                {currentBaby.firstName}
            </div>

            {/* Active Sleep Banner */}
            {activeSleep && (
                <div style={styles.sleepBanner}>
                    <span>SLEEPING since {formatTime(activeSleep.startTime)} ({timeAgo(now, activeSleep.startTime)})</span>
                    <form action="/api/kindle/log" method="POST" style={{ display: 'inline' }}>
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="action" value="sleep-end" />
                        <input type="hidden" name="babyId" value={currentBaby.id} />
                        <input type="hidden" name="sleepLogId" value={activeSleep.id} />
                        <button type="submit" style={styles.wakeButton}>WAKE UP</button>
                    </form>
                </div>
            )}

            {/* Quick Action Buttons Grid */}
            <div style={styles.grid}>
                {/* Feed - Bottle */}
                <div style={styles.card}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', color: '#1565c0', borderBottom: '2px solid #1565c0', paddingBottom: '8px' }}>BOTTLE</div>
                    <form action="/api/kindle/log" method="POST">
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="action" value="feed-bottle" />
                        <input type="hidden" name="babyId" value={currentBaby.id} />
                        <input type="hidden" name="unitAbbr" value={defaultUnit} />
                        <div style={{ marginBottom: '8px' }}>
                            <input
                                type="number"
                                name="amount"
                                placeholder={defaultUnit}
                                step="0.5"
                                style={styles.input}
                            />
                        </div>
                        <select name="bottleType" style={styles.select}>
                            <option value="formula">Formula</option>
                            <option value="breast milk">Breast Milk</option>
                            <option value="milk">Milk</option>
                            <option value="other">Other</option>
                        </select>
                        <button type="submit" style={{ ...styles.submitBtn, backgroundColor: '#1565c0' }}>Log Bottle</button>
                    </form>
                </div>

                {/* Feed - Breast */}
                <div style={styles.card}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', color: '#ad1457', borderBottom: '2px solid #ad1457', paddingBottom: '8px' }}>BREAST</div>
                    <form action="/api/kindle/log" method="POST">
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="action" value="feed-breast" />
                        <input type="hidden" name="babyId" value={currentBaby.id} />
                        <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                            <button type="submit" name="side" value="LEFT" style={{ ...styles.submitBtn, flex: 1, backgroundColor: '#ad1457' }}>Left</button>
                            <button type="submit" name="side" value="RIGHT" style={{ ...styles.submitBtn, flex: 1, backgroundColor: '#ad1457' }}>Right</button>
                        </div>
                    </form>
                </div>

                {/* Diaper */}
                <div style={styles.card}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', color: '#00838f', borderBottom: '2px solid #00838f', paddingBottom: '8px' }}>DIAPER</div>
                    <form action="/api/kindle/log" method="POST" style={{ display: 'flex', flexDirection: 'column' as const, gap: '16px' }}>
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="action" value="diaper" />
                        <input type="hidden" name="babyId" value={currentBaby.id} />
                        <button type="submit" name="type" value="WET" style={{ ...styles.submitBtn, backgroundColor: '#0288d1', padding: '16px' }}>Wet</button>
                        <button type="submit" name="type" value="DIRTY" style={{ ...styles.submitBtn, backgroundColor: '#795548', padding: '16px' }}>Dirty</button>
                        <button type="submit" name="type" value="BOTH" style={{ ...styles.submitBtn, backgroundColor: '#6a1b9a', padding: '16px' }}>Both</button>
                    </form>
                </div>

                {/* Sleep */}
                {!activeSleep && (
                    <div style={styles.card}>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', color: '#283593', borderBottom: '2px solid #283593', paddingBottom: '8px' }}>SLEEP</div>
                        <form action="/api/kindle/log" method="POST" style={{ display: 'flex', flexDirection: 'column' as const, gap: '16px' }}>
                            <input type="hidden" name="token" value={token} />
                            <input type="hidden" name="action" value="sleep-start" />
                            <input type="hidden" name="babyId" value={currentBaby.id} />
                            <button type="submit" name="sleepType" value="NIGHT_SLEEP" style={{ ...styles.submitBtn, backgroundColor: '#1a237e', padding: '16px' }}>Night Sleep</button>
                            <button type="submit" name="sleepType" value="NAP" style={{ ...styles.submitBtn, backgroundColor: '#5c6bc0', padding: '16px' }}>Nap</button>
                        </form>
                    </div>
                )}

                {/* Medicine */}
                {medicines.length > 0 && (
                    <div style={styles.card}>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', color: '#e65100', borderBottom: '2px solid #e65100', paddingBottom: '8px' }}>MEDICINE</div>
                        <form action="/api/kindle/log" method="POST">
                            <input type="hidden" name="token" value={token} />
                            <input type="hidden" name="action" value="medicine" />
                            <input type="hidden" name="babyId" value={currentBaby.id} />
                            <select name="medicineId" style={styles.select} required>
                                {medicines.map(med => (
                                    <option key={med.id} value={med.id}>
                                        {med.name}{med.typicalDoseSize ? ` (${med.typicalDoseSize}${med.unitAbbr || ''})` : ''}
                                    </option>
                                ))}
                            </select>
                            <div style={{ marginBottom: '8px' }}>
                                <input
                                    type="number"
                                    name="doseAmount"
                                    placeholder="Dose"
                                    step="0.25"
                                    style={styles.input}
                                />
                            </div>
                            <button type="submit" style={{ ...styles.submitBtn, backgroundColor: '#e65100' }}>Give Medicine</button>
                        </form>
                    </div>
                )}
            </div>

            {/* Recent Activity */}
            <div style={styles.recentActivity}>
                <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px', color: '#555', borderBottom: '1px solid #ddd', paddingBottom: '4px' }}>Recent Activity</div>
                {lastFeed && (
                    <div style={styles.activityRow}>
                        <span style={{ color: '#1565c0', fontWeight: 'bold' }}>Feed:</span> <strong>{feedAgo}</strong>
                        {lastFeed.type === 'BOTTLE' && lastFeed.amount ? ` - ${lastFeed.amount}${lastFeed.unitAbbr || 'oz'}` : ''}
                        {lastFeed.type === 'BREAST' && lastFeed.side ? ` - ${lastFeed.side.toLowerCase()} side` : ''}
                    </div>
                )}
                {lastDiaper && (
                    <div style={styles.activityRow}>
                        <span style={{ color: '#00838f', fontWeight: 'bold' }}>Diaper:</span> <strong>{diaperAgo}</strong> - {lastDiaper.type.toLowerCase()}
                    </div>
                )}
                {!lastFeed && !lastDiaper && (
                    <div style={{ ...styles.activityRow, color: '#999' }}>No recent activity</div>
                )}
            </div>
        </div>
    );
}

// Helper functions
function timeAgo(now: Date, then: Date): string {
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    const remainMins = diffMins % 60;

    if (diffHours < 24) {
        return remainMins > 0 ? `${diffHours}h ${remainMins}m ago` : `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

function formatTime(date: Date): string {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

// Inline styles - colorful theme for Kindle Colorsoft
const styles: Record<string, React.CSSProperties> = {
    container: {
        maxWidth: '600px',
        margin: '0 auto',
        padding: '12px',
        minHeight: '100vh',
        backgroundColor: '#fafafa',
        color: '#222',
        fontFamily: 'sans-serif',
    },
    header: {
        textAlign: 'center',
        padding: '12px 0',
        borderBottom: '3px solid #2e7d32',
        marginBottom: '12px',
    },
    babySelector: {
        display: 'flex',
        gap: '8px',
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginBottom: '12px',
    },
    babyTab: {
        padding: '10px 20px',
        backgroundColor: '#e8e8e8',
        color: '#333',
        textDecoration: 'none',
        borderRadius: '6px',
        fontSize: '16px',
        fontWeight: 'bold',
        border: '2px solid #bbb',
    },
    babyTabActive: {
        backgroundColor: '#2e7d32',
        color: '#fff',
        border: '2px solid #1b5e20',
    },
    successToast: {
        backgroundColor: '#e8f5e9',
        color: '#1b5e20',
        padding: '12px 16px',
        borderRadius: '6px',
        textAlign: 'center',
        marginBottom: '12px',
        fontSize: '18px',
        fontWeight: 'bold',
        border: '2px solid #4caf50',
    },
    errorToast: {
        backgroundColor: '#ffebee',
        color: '#b71c1c',
        padding: '12px 16px',
        borderRadius: '6px',
        textAlign: 'center',
        marginBottom: '12px',
        fontSize: '18px',
        fontWeight: 'bold',
        border: '2px solid #e53935',
    },
    sleepBanner: {
        backgroundColor: '#e8eaf6',
        color: '#1a237e',
        padding: '14px 16px',
        borderRadius: '6px',
        textAlign: 'center',
        marginBottom: '12px',
        fontSize: '16px',
        fontWeight: 'bold',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
        border: '2px solid #3949ab',
    },
    wakeButton: {
        backgroundColor: '#ef6c00',
        color: '#fff',
        border: 'none',
        padding: '12px 28px',
        borderRadius: '6px',
        fontSize: '18px',
        fontWeight: 'bold',
        cursor: 'pointer',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '14px',
        marginBottom: '16px',
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: '8px',
        padding: '16px',
        textAlign: 'center',
        border: '2px solid #ddd',
    },
    input: {
        width: '100%',
        padding: '10px',
        fontSize: '16px',
        backgroundColor: '#fff',
        color: '#222',
        border: '2px solid #aaa',
        borderRadius: '6px',
        boxSizing: 'border-box',
    },
    select: {
        width: '100%',
        padding: '10px',
        fontSize: '16px',
        backgroundColor: '#fff',
        color: '#222',
        border: '2px solid #aaa',
        borderRadius: '6px',
        marginBottom: '8px',
        boxSizing: 'border-box',
    },
    submitBtn: {
        width: '100%',
        padding: '14px',
        fontSize: '16px',
        fontWeight: 'bold',
        backgroundColor: '#333',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
    },
    recentActivity: {
        backgroundColor: '#fff',
        borderRadius: '8px',
        padding: '16px',
        border: '2px solid #ddd',
    },
    activityRow: {
        padding: '6px 0',
        fontSize: '16px',
        borderBottom: '1px solid #eee',
    },
    errorPage: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        textAlign: 'center',
        padding: '20px',
    },
};
