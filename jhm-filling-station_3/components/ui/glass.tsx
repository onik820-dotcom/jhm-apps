import { cn } from '@/lib/utils';

export function GlassCard({
  className,
  lift = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { lift?: boolean }) {
  return <div className={cn('glass p-4 sm:p-5', lift && 'glass-lift', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-sm font-semibold tracking-tight', className)}
      style={{ color: 'var(--text-muted)' }}
      {...props}
    />
  );
}

export function CardValue({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('tabular mt-1 text-2xl font-semibold tracking-tight sm:text-3xl', className)} {...props} />;
}

export function Muted({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs', className)} style={{ color: 'var(--text-faint)' }} {...props} />;
}

export type ToneState = 'ok' | 'watch' | 'breach' | 'neutral';

const TONE_CLASS: Record<ToneState, string> = {
  ok: 'state-ok',
  watch: 'state-watch',
  breach: 'state-breach',
  neutral: '',
};

export function Chip({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: ToneState }) {
  return <span className={cn('chip', TONE_CLASS[tone], className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
        {title}
      </p>
      {hint ? <Muted>{hint}</Muted> : null}
    </div>
  );
}
