import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-[420px] w-full p-6 text-center">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-brand-soft text-brand mx-auto">
          <Compass size={20} />
        </span>
        <h1 className="text-[17px] font-semibold tracking-[-0.02em] mt-4">Page not found</h1>
        <p className="text-[13px] text-ink-2 mt-2">
          That route does not exist in this workspace.
        </p>
        <Link className="btn btn-primary mt-5 inline-flex" href="/inbox">
          Go to the inbox
        </Link>
      </div>
    </div>
  );
}
