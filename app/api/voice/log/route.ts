import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../db';
import { ApiResponse } from '../../types';
import { validateDeviceToken } from '../../utils/auth';

/**
 * POST /api/voice/log
 * 
 * JSON-based endpoint for Home Assistant / voice assistant integration.
 * Authenticated via device token in Authorization: Bearer {token} header.
 * 
 * Request body:
 * {
 *   "action": "bottle" | "breast" | "diaper" | "sleep" | "wake" | "medicine" | "bath" | "pump" | "pump-log" | "pump-end" | "undo" | "edit",
 *   "babyName": "Charlotte",      // optional - auto-selects if only one active baby
 *   "amount": 4,                   // optional - numeric amount
 *   "unit": "oz",                  // optional - defaults to family setting
 *   "type": "wet",                 // for diaper: wet, dirty, both, dry
 *   "side": "left",               // for breast: left, right, both
 *   "sleepType": "nap",           // for sleep: nap, night
 *   "bottleType": "formula",      // for bottle: formula, breast_milk, etc.
 *   "medicine": "Tylenol",        // for medicine: name of the medicine
 *   "leftAmount": 15,             // for pump-log: left breast amount
 *   "rightAmount": 20,            // for pump-log: right breast amount
 *   "logType": "bottle"           // for undo/edit: which log type to target
 * }
 * 
 * Response:
 * { "success": true, "message": "Logged bottle feeding: 4 oz" }
 */
export async function POST(req: NextRequest) {
    try {
        // Extract device token from Authorization header
        const authHeader = req.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'Missing Authorization: Bearer {device_token} header' },
                { status: 401 }
            );
        }

        const token = authHeader.slice(7);
        const authResult = await validateDeviceToken(token);

        if (!authResult.authenticated || !authResult.familyId) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: authResult.error || 'Invalid or expired device token' },
                { status: 401 }
            );
        }

        const { familyId, caretakerId } = authResult;

        // Parse JSON body
        const body = await req.json();
        const { action, babyName, amount, unit, type, side, sleepType, bottleType, medicine, duration, logType, leftAmount, rightAmount } = body;

        if (!action) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'Missing required field: action' },
                { status: 400 }
            );
        }

        // Resolve baby - by name or auto-select if only one
        const baby = await resolveBaby(familyId, babyName);
        if (!baby) {
            const babies = await prisma.baby.findMany({
                where: { familyId, inactive: false },
                select: { firstName: true },
            });
            const names = babies.map(b => b.firstName).join(', ');
            return NextResponse.json<ApiResponse<null>>(
                {
                    success: false, error: babyName
                        ? `Baby "${babyName}" not found. Available: ${names}`
                        : `Multiple babies found. Please specify babyName. Available: ${names}`
                },
                { status: 400 }
            );
        }

        // Fetch family settings for defaults
        const settings = await prisma.settings.findFirst({
            where: { familyId },
            select: { defaultBottleUnit: true },
        });

        const now = new Date();
        const babyId = baby.id;
        const babyFirstName = baby.firstName;

        switch (action.toLowerCase()) {
            case 'bottle': {
                const feedAmount = amount ? parseFloat(amount) : undefined;
                const feedUnit = resolveUnit(unit, settings?.defaultBottleUnit || 'OZ');

                await prisma.feedLog.create({
                    data: {
                        babyId,
                        time: now,
                        type: 'BOTTLE',
                        amount: feedAmount,
                        unitAbbr: feedUnit,
                        bottleType: bottleType || null,
                        caretakerId,
                        familyId,
                    },
                });

                const msg = feedAmount
                    ? `Logged bottle feeding for ${babyFirstName}: ${feedAmount} ${feedUnit.toLowerCase()}`
                    : `Logged bottle feeding for ${babyFirstName}`;
                return success(msg);
            }

            case 'breast':
            case 'nursing': {
                const breastSide = resolveSide(side);

                await prisma.feedLog.create({
                    data: {
                        babyId,
                        time: now,
                        type: 'BREAST',
                        side: breastSide as any,
                        caretakerId,
                        familyId,
                    },
                });

                const sideMsg = breastSide ? ` (${breastSide.toLowerCase()})` : '';
                return success(`Logged nursing for ${babyFirstName}${sideMsg}`);
            }

            case 'diaper': {
                const diaperType = resolveDiaperType(type);

                await prisma.diaperLog.create({
                    data: {
                        babyId,
                        time: now,
                        type: diaperType as any,
                        caretakerId,
                        familyId,
                    },
                });

                return success(`Logged ${diaperType.toLowerCase()} diaper for ${babyFirstName}`);
            }

            case 'sleep-start':
            case 'sleep_start':
            case 'nap':
            case 'sleep': {
                const resolvedSleepType = resolveSleepType(sleepType || action);

                await prisma.sleepLog.create({
                    data: {
                        babyId,
                        startTime: now,
                        type: resolvedSleepType as any,
                        caretakerId,
                        familyId,
                    },
                });

                const typeLabel = resolvedSleepType === 'NAP' ? 'nap' : 'sleep';
                return success(`Started ${typeLabel} for ${babyFirstName}`);
            }

            case 'sleep-end':
            case 'sleep_end':
            case 'wake':
            case 'woke':
            case 'awake': {
                // Find the most recent sleep log without an end time
                const activeSleep = await prisma.sleepLog.findFirst({
                    where: { babyId, familyId, endTime: null },
                    orderBy: { startTime: 'desc' },
                });

                if (!activeSleep) {
                    return NextResponse.json<ApiResponse<null>>(
                        { success: false, error: `No active sleep session found for ${babyFirstName}` },
                        { status: 400 }
                    );
                }

                const durationMinutes = Math.round((now.getTime() - activeSleep.startTime.getTime()) / 60000);
                await prisma.sleepLog.update({
                    where: { id: activeSleep.id },
                    data: { endTime: now, duration: durationMinutes },
                });

                const hours = Math.floor(durationMinutes / 60);
                const mins = durationMinutes % 60;
                const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} minutes`;
                return success(`${babyFirstName} woke up after ${durationStr}`);
            }

            case 'medicine':
            case 'medication':
            case 'med':
            case 'meds': {
                if (!medicine) {
                    return NextResponse.json<ApiResponse<null>>(
                        { success: false, error: 'Missing required field: medicine (name of the medicine)' },
                        { status: 400 }
                    );
                }

                // Find medicine by name (case-insensitive via manual comparison since SQLite)
                const allMeds = await prisma.medicine.findMany({
                    where: {
                        familyId,
                        active: true,
                    },
                });
                const med = allMeds.find(m => m.name.toLowerCase() === medicine.toLowerCase()) || null;

                if (!med) {
                    const available = await prisma.medicine.findMany({
                        where: { familyId, active: true },
                        select: { name: true },
                    });
                    const names = available.map(m => m.name).join(', ');
                    return NextResponse.json<ApiResponse<null>>(
                        { success: false, error: `Medicine "${medicine}" not found. Available: ${names || 'none'}` },
                        { status: 400 }
                    );
                }

                const doseAmount = amount ? parseFloat(amount) : (med.typicalDoseSize || 1);
                const doseUnit = unit || med.unitAbbr;

                await prisma.medicineLog.create({
                    data: {
                        babyId,
                        medicineId: med.id,
                        time: now,
                        doseAmount,
                        unitAbbr: doseUnit,
                        caretakerId,
                        familyId,
                    },
                });

                return success(`Logged ${med.name} for ${babyFirstName}: ${doseAmount} ${doseUnit?.toLowerCase() || ''}`);
            }

            case 'bath': {
                await prisma.bathLog.create({
                    data: {
                        babyId,
                        time: now,
                        caretakerId,
                        familyId,
                    },
                });

                return success(`Logged bath for ${babyFirstName}`);
            }

            case 'pump':
            case 'pump-start':
            case 'pump_start':
            case 'pumping': {
                const pumpDuration = duration ? parseInt(duration) : undefined;

                await prisma.pumpLog.create({
                    data: {
                        babyId,
                        startTime: now,
                        duration: pumpDuration,
                        totalAmount: amount ? parseFloat(amount) : undefined,
                        unitAbbr: resolveUnit(unit, 'OZ'),
                        caretakerId,
                        familyId,
                    },
                });

                const durationMsg = pumpDuration ? ` (${pumpDuration} min timer)` : '';
                return success(`Started pumping session for ${babyFirstName}${durationMsg}`);
            }

            case 'pump-log':
            case 'pump_log': {
                // Log a completed pump session after the fact
                const pumpUnit = resolveUnit(unit, 'ML');
                const left = leftAmount ? parseFloat(leftAmount) : undefined;
                const right = rightAmount ? parseFloat(rightAmount) : undefined;
                const total = amount ? parseFloat(amount) : (left || 0) + (right || 0) || undefined;
                const dur = duration ? parseInt(duration) : 15; // default 15 min
                const endTime = now;
                const startTime = new Date(now.getTime() - dur * 60000);

                await prisma.pumpLog.create({
                    data: {
                        babyId,
                        startTime,
                        endTime,
                        duration: dur,
                        leftAmount: left,
                        rightAmount: right,
                        totalAmount: total,
                        unitAbbr: pumpUnit,
                        caretakerId,
                        familyId,
                    },
                });

                const parts: string[] = [];
                if (left !== undefined) parts.push(`${left} ${pumpUnit.toLowerCase()} left`);
                if (right !== undefined) parts.push(`${right} ${pumpUnit.toLowerCase()} right`);
                if (total !== undefined && parts.length === 0) parts.push(`${total} ${pumpUnit.toLowerCase()} total`);
                const detail = parts.length > 0 ? `: ${parts.join(', ')}` : '';
                return success(`Logged pump session for ${babyFirstName}${detail} (${dur} min)`);
            }

            case 'pump-end':
            case 'pump_end':
            case 'pump-stop':
            case 'pump_stop': {
                const activePump = await prisma.pumpLog.findFirst({
                    where: { babyId, familyId, endTime: null, deletedAt: null },
                    orderBy: { startTime: 'desc' },
                });

                if (!activePump) {
                    return NextResponse.json<ApiResponse<null>>(
                        { success: false, error: `No active pump session found for ${babyFirstName}` },
                        { status: 400 }
                    );
                }

                const pumpDurationMinutes = Math.round((now.getTime() - activePump.startTime.getTime()) / 60000);
                const updateData: any = {
                    endTime: now,
                    duration: pumpDurationMinutes,
                };
                if (amount) {
                    updateData.totalAmount = parseFloat(amount);
                    updateData.unitAbbr = resolveUnit(unit, 'OZ');
                }

                await prisma.pumpLog.update({
                    where: { id: activePump.id },
                    data: updateData,
                });

                const amtMsg = amount ? ` — ${parseFloat(amount)} ${resolveUnit(unit, 'OZ').toLowerCase()} total` : '';
                const hours = Math.floor(pumpDurationMinutes / 60);
                const mins = pumpDurationMinutes % 60;
                const durStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} minutes`;
                return success(`Pump session ended for ${babyFirstName} after ${durStr}${amtMsg}`);
            }

            case 'undo':
            case 'undo-last':
            case 'delete-last': {
                const resolved = resolveLogType(logType);
                if (!resolved) {
                    return NextResponse.json<ApiResponse<null>>(
                        { success: false, error: 'Missing or invalid logType. Specify: bottle, breast, diaper, sleep, bath, medicine, or pump' },
                        { status: 400 }
                    );
                }

                const { model, entry } = await findLastEntry(resolved, babyId, familyId);
                if (!entry) {
                    return NextResponse.json<ApiResponse<null>>(
                        { success: false, error: `No recent ${resolved} entry found for ${babyFirstName}` },
                        { status: 404 }
                    );
                }

                const prismaModel = (prisma as any)[model!];
                await prismaModel.update({
                    where: { id: entry.id },
                    data: { deletedAt: new Date() },
                });

                const desc = describeEntry(resolved, entry);
                return success(`Deleted the last ${desc} for ${babyFirstName}`);
            }

            case 'edit':
            case 'edit-last':
            case 'update-last': {
                const resolved = resolveLogType(logType);
                if (!resolved) {
                    return NextResponse.json<ApiResponse<null>>(
                        { success: false, error: 'Missing or invalid logType. Specify: bottle, breast, diaper, sleep, bath, medicine, or pump' },
                        { status: 400 }
                    );
                }

                const { model, entry } = await findLastEntry(resolved, babyId, familyId);
                if (!entry) {
                    return NextResponse.json<ApiResponse<null>>(
                        { success: false, error: `No recent ${resolved} entry found for ${babyFirstName}` },
                        { status: 404 }
                    );
                }

                const prismaModel = (prisma as any)[model!];
                const updateData: any = {};
                const changes: string[] = [];
                const e = entry as any;

                if (resolved === 'bottle' || resolved === 'breast') {
                    if (amount !== undefined) {
                        updateData.amount = parseFloat(amount);
                        const u = resolveUnit(unit, e.unitAbbr || 'OZ');
                        updateData.unitAbbr = u;
                        changes.push(`${parseFloat(amount)} ${u.toLowerCase()}`);
                    }
                    if (side) {
                        updateData.side = resolveSide(side);
                        changes.push(`side to ${updateData.side?.toLowerCase()}`);
                    }
                    if (bottleType) {
                        updateData.bottleType = bottleType;
                        changes.push(`type to ${bottleType}`);
                    }
                } else if (resolved === 'diaper') {
                    if (type) {
                        updateData.type = resolveDiaperType(type);
                        changes.push(`${updateData.type.toLowerCase()}`);
                    }
                } else if (resolved === 'sleep') {
                    if (sleepType) {
                        updateData.type = resolveSleepType(sleepType);
                        changes.push(`${updateData.type === 'NAP' ? 'nap' : 'night sleep'}`);
                    }
                } else if (resolved === 'medicine') {
                    if (amount !== undefined) {
                        updateData.doseAmount = parseFloat(amount);
                        changes.push(`dose to ${parseFloat(amount)}`);
                    }
                    if (unit) {
                        updateData.unitAbbr = unit;
                        changes.push(`unit to ${unit}`);
                    }
                } else if (resolved === 'pump') {
                    if (amount !== undefined) {
                        updateData.totalAmount = parseFloat(amount);
                        const u = resolveUnit(unit, 'OZ');
                        updateData.unitAbbr = u;
                        changes.push(`${parseFloat(amount)} ${u.toLowerCase()}`);
                    }
                }

                if (Object.keys(updateData).length === 0) {
                    return NextResponse.json<ApiResponse<null>>(
                        { success: false, error: 'No fields to update. Provide amount, type, side, etc.' },
                        { status: 400 }
                    );
                }

                await prismaModel.update({
                    where: { id: entry.id },
                    data: updateData,
                });

                const desc = describeEntry(resolved, entry);
                const changeStr = changes.join(', ');
                return success(`Updated the last ${desc} for ${babyFirstName}: ${changeStr}`);
            }

            default:
                return NextResponse.json<ApiResponse<null>>(
                    { success: false, error: `Unknown action: "${action}". Supported: bottle, breast, diaper, sleep, wake, medicine, bath, pump, pump-end, undo, edit` },
                    { status: 400 }
                );
        }
    } catch (error) {
        console.error('Voice log error:', error);
        return NextResponse.json<ApiResponse<null>>(
            { success: false, error: 'An error occurred processing the request' },
            { status: 500 }
        );
    }
}

// --- Helper functions ---

function success(message: string) {
    return NextResponse.json<ApiResponse<{ message: string }>>({
        success: true,
        data: { message },
    });
}

async function resolveBaby(familyId: string, babyName?: string) {
    if (babyName) {
        // Find by first name (case-insensitive via manual comparison since SQLite)
        const allBabies = await prisma.baby.findMany({
            where: {
                familyId,
                inactive: false,
            },
            select: { id: true, firstName: true },
        });
        return allBabies.find(b => b.firstName.toLowerCase() === babyName.toLowerCase()) || null;
    }

    // Auto-select if only one active baby
    const babies = await prisma.baby.findMany({
        where: { familyId, inactive: false },
        select: { id: true, firstName: true },
    });

    return babies.length === 1 ? babies[0] : null;
}

function resolveUnit(unit: string | undefined, defaultUnit: string): string {
    if (!unit) return defaultUnit;

    const u = unit.toLowerCase().trim();
    if (['oz', 'ounce', 'ounces'].includes(u)) return 'OZ';
    if (['ml', 'milliliter', 'milliliters'].includes(u)) return 'ML';
    if (['tbsp', 'tablespoon', 'tablespoons'].includes(u)) return 'TBSP';
    if (['g', 'gram', 'grams'].includes(u)) return 'G';

    return defaultUnit;
}

function resolveSide(side: string | undefined): string | undefined {
    if (!side) return undefined;

    const s = side.toLowerCase().trim();
    if (['left', 'l'].includes(s)) return 'LEFT';
    if (['right', 'r'].includes(s)) return 'RIGHT';
    if (['both', 'b'].includes(s)) return 'BOTH';

    return undefined;
}

function resolveDiaperType(type: string | undefined): string {
    if (!type) return 'WET';

    const t = type.toLowerCase().trim();
    if (['wet', 'pee'].includes(t)) return 'WET';
    if (['dirty', 'poop', 'soiled', 'bm'].includes(t)) return 'DIRTY';
    if (['both', 'mixed'].includes(t)) return 'BOTH';
    if (['dry', 'clean'].includes(t)) return 'DRY';

    return 'WET';
}

function resolveSleepType(sleepType: string | undefined): string {
    if (!sleepType) return 'NAP';

    const t = sleepType.toLowerCase().trim();
    if (['nap', 'napping'].includes(t)) return 'NAP';
    if (['night', 'night_sleep', 'night-sleep', 'bedtime', 'sleep'].includes(t)) return 'NIGHT_SLEEP';

    return 'NAP';
}

function resolveLogType(logType: string | undefined): string | null {
    if (!logType) return null;
    const t = logType.toLowerCase().trim();
    if (['bottle', 'formula'].includes(t)) return 'bottle';
    if (['breast', 'nursing'].includes(t)) return 'breast';
    if (['diaper'].includes(t)) return 'diaper';
    if (['sleep', 'nap'].includes(t)) return 'sleep';
    if (['bath'].includes(t)) return 'bath';
    if (['medicine', 'med', 'meds', 'medication'].includes(t)) return 'medicine';
    if (['pump', 'pumping'].includes(t)) return 'pump';
    return null;
}

async function findLastEntry(logType: string, babyId: string, familyId: string) {
    const baseWhere = { babyId, familyId, deletedAt: null };
    switch (logType) {
        case 'bottle':
            return { model: 'feedLog', entry: await prisma.feedLog.findFirst({ where: { ...baseWhere, type: 'BOTTLE' }, orderBy: { time: 'desc' } }) };
        case 'breast':
            return { model: 'feedLog', entry: await prisma.feedLog.findFirst({ where: { ...baseWhere, type: 'BREAST' }, orderBy: { time: 'desc' } }) };
        case 'diaper':
            return { model: 'diaperLog', entry: await prisma.diaperLog.findFirst({ where: baseWhere, orderBy: { time: 'desc' } }) };
        case 'sleep':
            return { model: 'sleepLog', entry: await prisma.sleepLog.findFirst({ where: baseWhere, orderBy: { startTime: 'desc' } }) };
        case 'bath':
            return { model: 'bathLog', entry: await prisma.bathLog.findFirst({ where: baseWhere, orderBy: { time: 'desc' } }) };
        case 'medicine':
            return { model: 'medicineLog', entry: await prisma.medicineLog.findFirst({ where: baseWhere, orderBy: { time: 'desc' }, include: { medicine: { select: { name: true } } } }) };
        case 'pump':
            return { model: 'pumpLog', entry: await prisma.pumpLog.findFirst({ where: baseWhere, orderBy: { startTime: 'desc' } }) };
        default:
            return { model: null, entry: null };
    }
}

function formatEntryTime(entry: any): string {
    const time = entry.time || entry.startTime;
    if (!time) return '';
    return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
    }).format(new Date(time));
}

function describeEntry(logType: string, entry: any): string {
    const time = formatEntryTime(entry);
    switch (logType) {
        case 'bottle': {
            const amt = entry.amount ? `${entry.amount} ${(entry.unitAbbr || 'oz').toLowerCase()} ` : '';
            return `${amt}bottle from ${time}`.trim();
        }
        case 'breast': {
            const s = entry.side ? ` (${entry.side.toLowerCase()})` : '';
            return `nursing${s} from ${time}`;
        }
        case 'diaper':
            return `${(entry.type || 'wet').toLowerCase()} diaper from ${time}`;
        case 'sleep':
            return `${entry.type === 'NAP' ? 'nap' : 'sleep'} from ${time}`;
        case 'bath':
            return `bath from ${time}`;
        case 'medicine': {
            const name = entry.medicine?.name || 'medicine';
            return `${name} from ${time}`;
        }
        case 'pump':
            return `pump session from ${time}`;
        default:
            return `entry from ${time}`;
    }
}
