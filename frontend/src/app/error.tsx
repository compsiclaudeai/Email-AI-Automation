'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

/**
 * Route-level error boundary.
 *
 * Without one, any thrown render error in the app directory shows the default
 * Next.js error screen in development and a blank page in production, with no
 * way back other than a manual reload.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-[460px] w-full p-6 text-center">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-danger-soft text-danger mx-auto">
          <AlertTriangle size={20} />
        </span>
        <h1 className="text-[17px] font-semibold tracking-[-0.02em] mt-4">Something broke here</h1>
        <p className="text-[13px] text-ink-2 mt-2 leading-relaxed">
          The page hit an error it could not recover from on its own. Nothing was sent, and no email
          was changed.
        </p>
        {error.digest && (
          <p className="text-[11.5px] text-ink-3 mt-2 font-mono">Reference: {error.digest}</p>
        )}
        <div className="flex justify-center gap-2 mt-5">
          <button className="btn btn-primary" onClick={reset}>
            <RotateCw size={14} /> Try again
          </button>
          <a className="btn" href="/inbox">
            Back to the inbox
          </a>
        </div>
      </div>
    </div>
  );
}
