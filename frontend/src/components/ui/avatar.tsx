import { avatarColour, initials } from '@/lib/format';

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-full shrink-0 font-semibold text-white tracking-[-0.01em]"
      style={{
        width: size,
        height: size,
        background: avatarColour(name),
        fontSize: Math.round(size / 2.9),
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
