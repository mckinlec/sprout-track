import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../db';
import { validateDeviceToken } from '../../utils/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ha/query
 *
 * Returns a concise, human-readable plain-text summary of baby status
 * designed for LLM / voice assistant consumption.
 *
 * Authenticated via device token in Authorization: Bearer {token} header.
 *
 * The response is plain text so an LLM can read it directly and relay
 * the information to the user in natural speech.
 */
export async function GET(req: NextRequest) {
    try {
        const authHeader = req.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const token = authHeader.slice(7);
        const authResult = await validateDeviceToken(token);

        if (!authResult.authenticated || !authResult.familyId) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const { familyId } = authResult;

        const babies = await prisma.baby.findMany({
            where: { familyId, inactive: false },
            select: { id: true, firstName: true },
        });

        // Calculate midnight in Eastern time (server may be UTC in Docker)
        const todayStart = getMidnightEastern();

        const summaries = await Promise.all(babies.map(async (baby) => {
            const babyId = baby.id;
            const name = baby.firstName;

            const [
                lastFeed,
                lastDiaper,
                activeSleep,
                lastSleep,
                lastBath,
                lastMedicine,
                todayFeeds,
                todayDiapers,
                todayBottleFeeds,
            ] = await Promise.all([
                prisma.feedLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    select: { time: true, type: true, amount: true, unitAbbr: true, side: true, bottleType: true },
                }),
                prisma.diaperLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    select: { time: true, type: true },
                }),
                prisma.sleepLog.findFirst({
                    where: { babyId, familyId, deletedAt: null, endTime: null },
                    orderBy: { startTime: 'desc' },
                    select: { startTime: true, type: true },
                }),
                prisma.sleepLog.findFirst({
                    where: { babyId, familyId, deletedAt: null, endTime: { not: null } },
                    orderBy: { startTime: 'desc' },
                    select: { startTime: true, endTime: true, type: true, duration: true },
                }),
                prisma.bathLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    select: { time: true },
                }),
                prisma.medicineLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    include: { medicine: { select: { name: true } } },
                }),
                prisma.feedLog.count({
                    where: { babyId, familyId, deletedAt: null, time: { gte: todayStart } },
                }),
                prisma.diaperLog.count({
                    where: { babyId, familyId, deletedAt: null, time: { gte: todayStart } },
                }),
                prisma.feedLog.findMany({
                    where: { babyId, familyId, deletedAt: null, type: 'BOTTLE', time: { gte: todayStart } },
                    select: { amount: true, unitAbbr: true },
                }),
            ]);

            const totalOz = todayBottleFeeds.reduce((sum, f) => {
                if (f.amount) {
                    if (f.unitAbbr === 'ML') return sum + (f.amount / 29.5735);
                    return sum + f.amount;
                }
                return sum;
            }, 0);

            const lines: string[] = [];

            // Last feed
            if (lastFeed) {
                const ago = timeAgo(lastFeed.time);
                const at = formatTime(lastFeed.time);
                if (lastFeed.type === 'BOTTLE') {
                    const amt = lastFeed.amount ? `${lastFeed.amount} ${(lastFeed.unitAbbr || 'oz').toLowerCase()}` : '';
                    const bt = lastFeed.bottleType ? ` ${lastFeed.bottleType.replace('_', ' ')}` : '';
                    lines.push(`Last feed: ${amt}${bt} bottle, ${ago} (at ${at})`);
                } else {
                    const side = lastFeed.side ? ` (${lastFeed.side.toLowerCase()} side)` : '';
                    lines.push(`Last feed: nursing${side}, ${ago} (at ${at})`);
                }
            } else {
                lines.push('Last feed: none recorded');
            }

            // Last diaper
            if (lastDiaper) {
                lines.push(`Last diaper: ${lastDiaper.type.toLowerCase()}, ${timeAgo(lastDiaper.time)} (at ${formatTime(lastDiaper.time)})`);
            } else {
                lines.push('Last diaper: none recorded');
            }

            // Sleep
            if (activeSleep) {
                const mins = Math.round((Date.now() - activeSleep.startTime.getTime()) / 60000);
                const type = activeSleep.type === 'NAP' ? 'napping' : 'sleeping';
                lines.push(`Sleep: currently ${type} for ${formatDuration(mins)} (started at ${formatTime(activeSleep.startTime)})`);
            } else {
                lines.push('Sleep: awake');
                if (lastSleep?.endTime) {
                    const dur = lastSleep.duration ? formatDuration(lastSleep.duration) : '';
                    lines.push(`Last sleep: ${dur}, ended ${timeAgo(lastSleep.endTime)} (at ${formatTime(lastSleep.endTime)})`);
                }
            }

            // Today stats
            lines.push(`Today: ${todayFeeds} feeds (${Math.round(totalOz * 10) / 10} oz total), ${todayDiapers} diapers`);

            // Bath
            if (lastBath) {
                lines.push(`Last bath: ${timeAgo(lastBath.time)} (at ${formatTime(lastBath.time)})`);
            }

            // Medicine
            if (lastMedicine) {
                const medName = lastMedicine.medicine?.name || 'unknown';
                lines.push(`Last medicine: ${medName}, ${timeAgo(lastMedicine.time)} (at ${formatTime(lastMedicine.time)})`);
            }

            return `${name}: ${lines.join('. ')}`;
        }));

        return NextResponse.json({ status: summaries.join('\n\n') });
    } catch (error) {
        console.error('HA query error:', error);
        return NextResponse.json({ status: 'Error fetching status' }, { status: 500 });
    }
}

function timeAgo(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const mins = Math.round(diffMs / 60000);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minutes ago`;

    const hours = Math.floor(mins / 60);
    const remaining = mins % 60;

    if (hours < 24) {
        return remaining > 0 ? `${hours}h ${remaining}m ago` : `${hours} hours ago`;
    }

    const days = Math.floor(hours / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
}

function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
    return `${mins} minutes`;
}

function getMidnightEastern(): Date {
    const now = new Date();
    // Get today's date in Eastern timezone (YYYY-MM-DD via en-CA locale)
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    // Check if currently in EDT (UTC-4) or EST (UTC-5)
    const tzName = now.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        timeZoneName: 'short',
    });
    const offsetHours = tzName.includes('EDT') ? 4 : 5;
    // Midnight Eastern in UTC = midnight + offset
    return new Date(`${dateStr}T${String(offsetHours).padStart(2, '0')}:00:00.000Z`);
}
