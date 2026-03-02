import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../db';
import { ApiResponse } from '../../types';
import { validateDeviceToken } from '../../utils/auth';

/**
 * GET /api/ha/status
 *
 * Returns comprehensive baby status data for Home Assistant integration.
 * Authenticated via device token in Authorization: Bearer {token} header.
 *
 * Returns all active babies with their latest activities and today's stats.
 */
export async function GET(req: NextRequest) {
    try {
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

        const { familyId } = authResult;

        // Get all active babies in the family
        const babies = await prisma.baby.findMany({
            where: { familyId, inactive: false },
            select: { id: true, firstName: true, lastName: true, birthDate: true, gender: true },
        });

        // Get today's start (midnight local — use server timezone)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const babyStatuses = await Promise.all(babies.map(async (baby) => {
            const babyId = baby.id;

            const [
                lastFeed,
                lastDiaper,
                activeSleep,
                lastSleep,
                lastBath,
                lastMedicine,
                lastMeasurements,
                lastNote,
                lastPump,
                lastPlay,
                lastMood,
                todayFeeds,
                todayDiapers,
                todayBottleFeeds,
            ] = await Promise.all([
                // Last feed
                prisma.feedLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    select: { time: true, type: true, amount: true, unitAbbr: true, side: true, bottleType: true },
                }),
                // Last diaper
                prisma.diaperLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    select: { time: true, type: true },
                }),
                // Active sleep (no end time)
                prisma.sleepLog.findFirst({
                    where: { babyId, familyId, deletedAt: null, endTime: null },
                    orderBy: { startTime: 'desc' },
                    select: { startTime: true, type: true },
                }),
                // Last completed sleep
                prisma.sleepLog.findFirst({
                    where: { babyId, familyId, deletedAt: null, endTime: { not: null } },
                    orderBy: { startTime: 'desc' },
                    select: { startTime: true, endTime: true, type: true, duration: true },
                }),
                // Last bath
                prisma.bathLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    select: { time: true },
                }),
                // Last medicine
                prisma.medicineLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    include: { medicine: { select: { name: true } } },
                }),
                // Last measurements (one of each type)
                prisma.measurement.findMany({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { date: 'desc' },
                    select: { type: true, value: true, unitAbbr: true, date: true },
                }),
                // Last note
                prisma.note.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    select: { time: true, content: true },
                }),
                // Last pump
                prisma.pumpLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    select: { time: true, amount: true, unitAbbr: true, side: true, duration: true },
                }),
                // Last play
                prisma.playLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { startTime: 'desc' },
                    select: { startTime: true, endTime: true, type: true, duration: true, milestone: true },
                }),
                // Last mood
                prisma.moodLog.findFirst({
                    where: { babyId, familyId, deletedAt: null },
                    orderBy: { time: 'desc' },
                    select: { time: true, mood: true },
                }),
                // Today's feed count
                prisma.feedLog.count({
                    where: { babyId, familyId, deletedAt: null, time: { gte: todayStart } },
                }),
                // Today's diaper count
                prisma.diaperLog.count({
                    where: { babyId, familyId, deletedAt: null, time: { gte: todayStart } },
                }),
                // Today's bottle feeds (for total oz)
                prisma.feedLog.findMany({
                    where: { babyId, familyId, deletedAt: null, type: 'BOTTLE', time: { gte: todayStart } },
                    select: { amount: true, unitAbbr: true },
                }),
            ]);

            // Calculate total oz today
            const totalOzToday = todayBottleFeeds.reduce((sum, f) => {
                if (f.amount) {
                    // Simple conversion — assume OZ unless ML
                    if (f.unitAbbr === 'ML') return sum + (f.amount / 29.5735);
                    return sum + f.amount;
                }
                return sum;
            }, 0);

            // Get unique latest measurement per type
            const latestMeasurements: Record<string, any> = {};
            for (const m of lastMeasurements) {
                if (!latestMeasurements[m.type]) {
                    latestMeasurements[m.type] = m;
                }
            }

            // Calculate sleep duration if currently sleeping
            let sleepDurationMinutes: number | null = null;
            if (activeSleep) {
                sleepDurationMinutes = Math.round((Date.now() - activeSleep.startTime.getTime()) / 60000);
            }

            return {
                id: babyId,
                name: baby.firstName,
                fullName: `${baby.firstName} ${baby.lastName || ''}`.trim(),
                birthDate: baby.birthDate?.toISOString() || null,
                gender: baby.gender,

                lastFeed: lastFeed ? {
                    time: lastFeed.time.toISOString(),
                    type: lastFeed.type,
                    amount: lastFeed.amount,
                    unit: lastFeed.unitAbbr,
                    side: lastFeed.side,
                    bottleType: lastFeed.bottleType,
                } : null,

                lastDiaper: lastDiaper ? {
                    time: lastDiaper.time.toISOString(),
                    type: lastDiaper.type,
                } : null,

                sleep: {
                    sleeping: !!activeSleep,
                    startTime: activeSleep?.startTime.toISOString() || null,
                    type: activeSleep?.type || null,
                    durationMinutes: sleepDurationMinutes,
                    lastCompleted: lastSleep ? {
                        startTime: lastSleep.startTime.toISOString(),
                        endTime: lastSleep.endTime?.toISOString() || null,
                        type: lastSleep.type,
                        durationMinutes: lastSleep.duration,
                    } : null,
                },

                lastBath: lastBath ? {
                    time: lastBath.time.toISOString(),
                } : null,

                lastMedicine: lastMedicine ? {
                    time: lastMedicine.time.toISOString(),
                    name: lastMedicine.medicine?.name || 'Unknown',
                    amount: lastMedicine.doseAmount,
                    unit: lastMedicine.unitAbbr,
                } : null,

                measurements: {
                    height: latestMeasurements['HEIGHT'] ? {
                        value: latestMeasurements['HEIGHT'].value,
                        unit: latestMeasurements['HEIGHT'].unitAbbr,
                        date: latestMeasurements['HEIGHT'].date.toISOString(),
                    } : null,
                    weight: latestMeasurements['WEIGHT'] ? {
                        value: latestMeasurements['WEIGHT'].value,
                        unit: latestMeasurements['WEIGHT'].unitAbbr,
                        date: latestMeasurements['WEIGHT'].date.toISOString(),
                    } : null,
                    headCircumference: latestMeasurements['HEAD_CIRCUMFERENCE'] ? {
                        value: latestMeasurements['HEAD_CIRCUMFERENCE'].value,
                        unit: latestMeasurements['HEAD_CIRCUMFERENCE'].unitAbbr,
                        date: latestMeasurements['HEAD_CIRCUMFERENCE'].date.toISOString(),
                    } : null,
                    temperature: latestMeasurements['TEMPERATURE'] ? {
                        value: latestMeasurements['TEMPERATURE'].value,
                        unit: latestMeasurements['TEMPERATURE'].unitAbbr,
                        date: latestMeasurements['TEMPERATURE'].date.toISOString(),
                    } : null,
                },

                lastNote: lastNote ? {
                    time: lastNote.time.toISOString(),
                    content: lastNote.content,
                } : null,

                lastPump: lastPump ? {
                    time: lastPump.time.toISOString(),
                    amount: lastPump.amount,
                    unit: lastPump.unitAbbr,
                    side: lastPump.side,
                    durationMinutes: lastPump.duration,
                } : null,

                lastPlay: lastPlay ? {
                    startTime: lastPlay.startTime.toISOString(),
                    endTime: lastPlay.endTime?.toISOString() || null,
                    type: lastPlay.type,
                    durationMinutes: lastPlay.duration,
                    milestone: lastPlay.milestone,
                } : null,

                lastMood: lastMood ? {
                    time: lastMood.time.toISOString(),
                    mood: lastMood.mood,
                } : null,

                todayStats: {
                    feedCount: todayFeeds,
                    diaperCount: todayDiapers,
                    totalBottleOz: Math.round(totalOzToday * 10) / 10,
                },
            };
        }));

        return NextResponse.json<ApiResponse<{ babies: typeof babyStatuses }>>({
            success: true,
            data: { babies: babyStatuses },
        });
    } catch (error) {
        console.error('HA status error:', error);
        return NextResponse.json<ApiResponse<null>>(
            { success: false, error: 'Failed to fetch status' },
            { status: 500 }
        );
    }
}
