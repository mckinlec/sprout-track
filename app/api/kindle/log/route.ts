import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../db';
import { validateDeviceToken } from '../../utils/auth';

// POST - Handle Kindle form submissions (standard HTML form POST)
export async function POST(req: NextRequest) {
    const origin = new URL(req.url).origin;
    let token = '';

    try {
        const formData = await req.formData();
        token = (formData.get('token') as string) || '';
        const action = formData.get('action') as string;
        const babyId = formData.get('babyId') as string;

        if (!token) {
            return redirectWithError(origin, token, 'Missing authentication token');
        }

        // Validate the device token
        const authResult = await validateDeviceToken(token);
        if (!authResult.authenticated || !authResult.familyId) {
            return redirectWithError(origin, token, authResult.error || 'Authentication failed');
        }

        const { familyId, caretakerId } = authResult;

        // Verify baby belongs to this family
        const baby = await prisma.baby.findFirst({
            where: { id: babyId, familyId },
        });

        if (!baby) {
            return redirectWithError(origin, token, 'Baby not found');
        }

        const now = new Date();

        switch (action) {
            case 'feed-bottle': {
                const amount = parseFloat(formData.get('amount') as string) || undefined;
                const unitAbbr = (formData.get('unitAbbr') as string) || 'OZ';
                const bottleType = (formData.get('bottleType') as string) || null;

                await prisma.feedLog.create({
                    data: {
                        babyId,
                        time: now,
                        type: 'BOTTLE',
                        amount,
                        unitAbbr,
                        bottleType,
                        caretakerId,
                        familyId,
                    },
                });
                return redirectWithSuccess(origin, token, babyId, 'feed');
            }

            case 'feed-breast': {
                const side = (formData.get('side') as string) || undefined;

                await prisma.feedLog.create({
                    data: {
                        babyId,
                        time: now,
                        type: 'BREAST',
                        side: side as any,
                        caretakerId,
                        familyId,
                    },
                });
                return redirectWithSuccess(origin, token, babyId, 'feed');
            }

            case 'diaper': {
                const type = (formData.get('type') as string) || 'WET';

                await prisma.diaperLog.create({
                    data: {
                        babyId,
                        time: now,
                        type: type as any,
                        caretakerId,
                        familyId,
                    },
                });
                return redirectWithSuccess(origin, token, babyId, 'diaper');
            }

            case 'sleep-start': {
                const sleepType = (formData.get('sleepType') as string) || 'NIGHT_SLEEP';

                await prisma.sleepLog.create({
                    data: {
                        babyId,
                        startTime: now,
                        type: sleepType as any,
                        caretakerId,
                        familyId,
                    },
                });
                return redirectWithSuccess(origin, token, babyId, 'sleep-start');
            }

            case 'sleep-end': {
                const sleepLogId = formData.get('sleepLogId') as string;

                if (sleepLogId) {
                    const sleepLog = await prisma.sleepLog.findFirst({
                        where: { id: sleepLogId, familyId },
                    });

                    if (sleepLog) {
                        const durationMinutes = Math.round((now.getTime() - sleepLog.startTime.getTime()) / 60000);
                        await prisma.sleepLog.update({
                            where: { id: sleepLogId },
                            data: { endTime: now, duration: durationMinutes },
                        });
                    }
                }
                return redirectWithSuccess(origin, token, babyId, 'sleep-end');
            }

            case 'medicine': {
                const medicineId = formData.get('medicineId') as string;
                const doseAmount = parseFloat(formData.get('doseAmount') as string) || 0;
                const medUnitAbbr = (formData.get('unitAbbr') as string) || undefined;

                if (!medicineId) {
                    return redirectWithError(origin, token, 'Medicine selection required');
                }

                // Verify medicine belongs to this family
                const medicine = await prisma.medicine.findFirst({
                    where: { id: medicineId, familyId, active: true },
                });

                if (!medicine) {
                    return redirectWithError(origin, token, 'Medicine not found');
                }

                await prisma.medicineLog.create({
                    data: {
                        babyId,
                        medicineId,
                        time: now,
                        doseAmount: doseAmount || medicine.typicalDoseSize || 1,
                        unitAbbr: medUnitAbbr || medicine.unitAbbr,
                        caretakerId,
                        familyId,
                    },
                });
                return redirectWithSuccess(origin, token, babyId, 'medicine');
            }

            default:
                return redirectWithError(origin, token, 'Unknown action');
        }
    } catch (error) {
        console.error('Kindle form submission error:', error);
        const fallbackOrigin = new URL(req.url).origin;
        return redirectWithError(fallbackOrigin, token, 'An error occurred');
    }
}

function redirectWithSuccess(origin: string, token: string, babyId: string, activity: string): NextResponse {
    const url = `${origin}/kindle/${token}?success=${activity}&babyId=${babyId}`;
    return NextResponse.redirect(url, 303);
}

function redirectWithError(origin: string, token: string, error: string): NextResponse {
    const path = token ? `/kindle/${token}` : `/kindle`;
    const url = `${origin}${path}?error=${encodeURIComponent(error)}`;
    return NextResponse.redirect(url, 303);
}
