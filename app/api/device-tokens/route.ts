import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { randomBytes } from 'crypto';

// POST - Generate a new device token (admin only)
async function handlePost(req: NextRequest, authContext: AuthResult) {
    try {
        const { familyId, caretakerId, caretakerRole, isSysAdmin } = authContext;

        // Only admins can create device tokens
        if (caretakerRole !== 'ADMIN' && !isSysAdmin) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'Admin access required to manage device tokens' },
                { status: 403 }
            );
        }

        if (!familyId) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'User is not associated with a family.' },
                { status: 403 }
            );
        }

        const body = await req.json();
        const { name, expiresAt } = body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'Device name is required' },
                { status: 400 }
            );
        }

        // Generate a cryptographically secure token (64-char hex)
        const token = randomBytes(32).toString('hex');

        const deviceToken = await prisma.deviceToken.create({
            data: {
                token,
                name: name.trim(),
                family: { connect: { id: familyId } },
                caretaker: { connect: { id: caretakerId! } },
                expiresAt: expiresAt ? new Date(expiresAt) : null,
            },
        });

        return NextResponse.json<ApiResponse<{
            id: string;
            token: string;
            name: string;
            createdAt: Date;
            expiresAt: Date | null;
        }>>({
            success: true,
            data: {
                id: deviceToken.id,
                token: deviceToken.token, // Only returned on creation
                name: deviceToken.name,
                createdAt: deviceToken.createdAt,
                expiresAt: deviceToken.expiresAt,
            },
        });
    } catch (error) {
        console.error('Error creating device token:', error);
        return NextResponse.json<ApiResponse<null>>(
            { success: false, error: 'Failed to create device token' },
            { status: 500 }
        );
    }
}

// GET - List all device tokens for the family
async function handleGet(req: NextRequest, authContext: AuthResult) {
    try {
        const { familyId, caretakerRole, isSysAdmin } = authContext;

        if (caretakerRole !== 'ADMIN' && !isSysAdmin) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'Admin access required' },
                { status: 403 }
            );
        }

        if (!familyId) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'User is not associated with a family.' },
                { status: 403 }
            );
        }

        const tokens = await prisma.deviceToken.findMany({
            where: { familyId },
            include: {
                caretaker: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Mask the token string for security (only show first 8 chars)
        const maskedTokens = tokens.map(t => ({
            id: t.id,
            tokenPreview: t.token.substring(0, 8) + '...',
            name: t.name,
            caretakerName: t.caretaker.name,
            expiresAt: t.expiresAt,
            revokedAt: t.revokedAt,
            lastUsedAt: t.lastUsedAt,
            createdAt: t.createdAt,
            isActive: !t.revokedAt && (!t.expiresAt || new Date() < t.expiresAt),
        }));

        return NextResponse.json<ApiResponse<typeof maskedTokens>>({
            success: true,
            data: maskedTokens,
        });
    } catch (error) {
        console.error('Error listing device tokens:', error);
        return NextResponse.json<ApiResponse<null>>(
            { success: false, error: 'Failed to list device tokens' },
            { status: 500 }
        );
    }
}

// DELETE - Revoke a device token by ID
async function handleDelete(req: NextRequest, authContext: AuthResult) {
    try {
        const { familyId, caretakerRole, isSysAdmin } = authContext;

        if (caretakerRole !== 'ADMIN' && !isSysAdmin) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'Admin access required' },
                { status: 403 }
            );
        }

        if (!familyId) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'User is not associated with a family.' },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'Device token ID is required' },
                { status: 400 }
            );
        }

        // Verify the token belongs to this family
        const existing = await prisma.deviceToken.findFirst({
            where: { id, familyId },
        });

        if (!existing) {
            return NextResponse.json<ApiResponse<null>>(
                { success: false, error: 'Device token not found' },
                { status: 404 }
            );
        }

        // Soft-revoke the token
        await prisma.deviceToken.update({
            where: { id },
            data: { revokedAt: new Date() },
        });

        return NextResponse.json<ApiResponse<void>>({ success: true });
    } catch (error) {
        console.error('Error revoking device token:', error);
        return NextResponse.json<ApiResponse<null>>(
            { success: false, error: 'Failed to revoke device token' },
            { status: 500 }
        );
    }
}

export const GET = withAuthContext(handleGet as any);
export const POST = withAuthContext(handlePost as any);
export const DELETE = withAuthContext(handleDelete as any);
