import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const button = cva(
  'tap-target inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium ' +
    'transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--color-accent)] text-white hover:brightness-110',
        glass: 'glass glass-lift',
        ghost: 'hover:bg-[var(--color-accent-soft)]',
        danger: 'bg-[var(--color-breach)] text-white hover:brightness-110',
      },
      size: {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-4 py-2.5',
        lg: 'px-6 py-3 text-base',
        forecourt: 'forecourt-button w-full flex-col px-6 py-6 text-left',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

export { button as buttonVariants };
