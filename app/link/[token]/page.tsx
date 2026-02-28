'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function MagicLinkPage() {
    const params = useParams();
    const token = params?.token as string;
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

    useEffect(() => {
        if (!token) {
            setError('No token provided');
            setStatus('error');
            return;
        }

        const authenticate = async () => {
            try {
                const response = await fetch('/api/auth/magic-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token }),
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    setError(data.error || 'Authentication failed');
                    setStatus('error');
                    return;
                }

                // Store auth data in localStorage (same as regular login)
                localStorage.setItem('authToken', data.data.token);
                localStorage.setItem('unlockTime', Date.now().toString());

                if (data.data.caretakerId) {
                    localStorage.setItem('caretakerId', data.data.caretakerId);
                }

                setStatus('success');

                // Redirect to the family's log-entry page
                const familySlug = data.data.familySlug;
                if (familySlug) {
                    window.location.href = `/${familySlug}/log-entry`;
                } else {
                    window.location.href = '/';
                }
            } catch (err) {
                console.error('Magic link authentication error:', err);
                setError('Something went wrong. Please try again.');
                setStatus('error');
            }
        };

        authenticate();
    }, [token]);

    if (status === 'error') {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100vh',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                backgroundColor: '#fafafa',
                padding: '20px',
                textAlign: 'center',
            }}>
                <div style={{
                    backgroundColor: '#fff',
                    borderRadius: '12px',
                    padding: '40px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    maxWidth: '400px',
                    width: '100%',
                }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
                    <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#c62828', marginBottom: '12px' }}>
                        Access Denied
                    </h1>
                    <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.5' }}>
                        {error}
                    </p>
                    <p style={{ fontSize: '14px', color: '#999', marginTop: '20px' }}>
                        This link may have been revoked or expired. Contact the account owner for a new link.
                    </p>
                </div>
            </div>
        );
    }

    // Loading / Success state
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            backgroundColor: '#fafafa',
            padding: '20px',
            textAlign: 'center',
        }}>
            <div style={{
                backgroundColor: '#fff',
                borderRadius: '12px',
                padding: '40px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                maxWidth: '400px',
                width: '100%',
            }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌱</div>
                <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#2e7d32', marginBottom: '12px' }}>
                    {status === 'success' ? 'Logged in!' : 'Signing you in...'}
                </h1>
                <p style={{ fontSize: '16px', color: '#666' }}>
                    {status === 'success' ? 'Redirecting to Baby Tracker...' : 'Please wait a moment...'}
                </p>
                <div style={{
                    marginTop: '20px',
                    width: '40px',
                    height: '40px',
                    border: '3px solid #e0e0e0',
                    borderTopColor: '#2e7d32',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    margin: '20px auto 0',
                }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        </div>
    );
}
