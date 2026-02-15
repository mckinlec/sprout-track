import { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Baby Tracker - Kindle',
};

export default function KindleLayout({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            margin: 0,
            padding: 0,
            backgroundColor: '#1a1a2e',
            color: '#eee',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            minHeight: '100vh',
        }}>
            {children}
        </div>
    );
}
