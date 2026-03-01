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
 *   "action": "bottle" | "breast" | "diaper" | "sleep-start" | "sleep-end" | "medicine",
 *   "babyName": "Charlotte",      // optional - auto-selects if only one active baby
 *   "amount": 4,                   // optional - numeric amount
 *   "unit": "oz",                  // optional - defaults to family setting
 *   "type": "wet",                 // for diaper: wet, dirty, both, dry
 *   "side": "left",               // for breast: left, right, both
 *   "sleepType": "nap",           // for sleep: nap, night
 *   "bottleType": "formula",      // for bottle: formula, breast_milk, etc.
 *   "medicine": "Tylenol"         // for medicine: name of the medicine
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
        const { action, babyName, amount, unit, type, side, sleepType, bottleType, medicine } = body;

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

                // Find medicine by name (case-insensitive)
                const med = await prisma.medicine.findFirst({
                    where: {
                        familyId,
                        active: true,
                        name: { equals: medicine, mode: 'insensitive' },
                    },
                });

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

            default:
                return NextResponse.json<ApiResponse<null>>(
                    { success: false, error: `Unknown action: "${action}". Supported: bottle, breast, diaper, sleep, wake, medicine` },
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
        // Find by first name (case-insensitive)
        return prisma.baby.findFirst({
            where: {
                familyId,
                inactive: false,
                firstName: { equals: babyName, mode: 'insensitive' },
            },
            select: { id: true, firstName: true },
        });
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
