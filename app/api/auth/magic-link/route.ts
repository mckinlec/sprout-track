import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../db';
import { ApiResponse } from '../../types';
import { validateDeviceToken } from '../../utils/auth';
import jwt from 'jsonwebtoken';

// Secret key for JWT signing
const JWT_SECRET = process.env.JWT_SECRET || 'baby-tracker-jwt-secret';

/**
 * POST /api/auth/magic-link
 * Validates a device token and issues a long-lived JWT for full app access.
 * This allows users to bookmark a link that auto-logs them in.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { token } = body;

        if (!token || typeof token !== 'string') {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'Device token is required' },
                { status: 400 }
            );
        }

        // Validate the device token using the existing system
        const authResult = await validateDeviceToken(token);

        if (!authResult.authenticated || !authResult.familyId) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: authResult.error || 'Invalid or expired device token' },
                { status: 401 }
            );
        }

        const { familyId, caretakerId, familySlug } = authResult;

        // Fetch caretaker details for the JWT payload
        let caretakerName = 'User';
        let caretakerType: string | null = null;
        let caretakerRole = 'USER';

        if (caretakerId) {
            const caretaker = await prisma.caretaker.findUnique({
                where: { id: caretakerId },
                select: { name: true, type: true, role: true },
            });

            if (caretaker) {
                caretakerName = caretaker.name;
                caretakerType = caretaker.type;
                caretakerRole = caretaker.role;
            }
        }

        // Sign a JWT with no expiration — access is controlled by the device token itself
        // (can be revoked anytime from Settings)
        const jwtToken = jwt.sign(
            {
                id: caretakerId || 'device',
                name: caretakerName,
                type: caretakerType,
                role: caretakerRole,
                familyId,
                familySlug,
                authType: 'DEVICE_TOKEN',
                isAccountAuth: false,
            },
            JWT_SECRET
            // No expiresIn — token lives until device token is revoked
        );

        return NextResponse.json<ApiResponse<{
            token: string;
            familySlug: string | null;
            caretakerId: string | null;
            caretakerName: string;
        }>>({
            success: true,
            data: {
                token: jwtToken,
                familySlug: familySlug || null,
                caretakerId: caretakerId || null,
                caretakerName,
            },
        });
    } catch (error) {
        console.error('Magic link authentication error:', error);
        return NextResponse.json<ApiResponse<null>>(
            { success: false, error: 'Authentication failed' },
            { status: 500 }
        );
    }
}
