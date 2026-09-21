'use client';

import { FileText } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatDate, formatDip, formatLitres, formatNumber } from '@/lib/format';
import { Chip, GlassCard, Muted } from '@/components/ui/glass';
import type { TankDetail } from '@/lib/data/stock';

/** The BSTI certificate details behind the chart, as printed on the document. */
export function TankMetadataCard({ tank }: { tank: TankDetail }) {
  const { t, lang } = useLang();

  const rows: Array<[string, string]> = [
    [t('tank.capacity'), formatLitres(tank.capacityLitres, lang)],
    [t('stock.finalDip'), tank.finalDipMm ? formatDip(tank.finalDipMm, lang) : '—'],
    [
      lang === 'bn' ? 'ভেতরের দৈর্ঘ্য' : 'Length inside',
      tank.lengthMm ? formatDip(tank.lengthMm, lang) : '—',
    ],
    [
      lang === 'bn' ? 'ভেতরের ব্যাস' : 'Diameter inside',
      tank.diameterMm ? formatDip(tank.diameterMm, lang) : '—',
    ],
    [
      lang === 'bn' ? 'ডিপ পাইপ' : 'Dip pipe',
      tank.dipPipeLengthMm ? formatDip(tank.dipPipeLengthMm, lang) : '—',
    ],
    [t('stock.calibratedBy'), tank.calibratedBy ?? '—'],
    [
      t('stock.calibrationDate'),
      tank.calibrationDate ? formatDate(tank.calibrationDate, lang) : '—',
    ],
    [
      t('stock.validity'),
      tank.validityFrom && tank.validityTo
        ? `${formatDate(tank.validityFrom, lang)} – ${formatDate(tank.validityTo, lang)}`
        : '—',
    ],
  ];

  return (
    <GlassCard lift={false} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          {t('tank.tank')} {tank.code}
        </h2>
        {tank.calibrationOffice ? <Chip>{tank.calibrationOffice}</Chip> : null}
        {tank.chartExpired ? (
          <Chip tone="breach" lang={lang}>
            {t('tank.chartExpires')} {tank.validityTo}
          </Chip>
        ) : tank.chartExpiringSoon ? (
          <Chip tone="watch" lang={lang}>
            {formatNumber(tank.chartDaysRemaining ?? 0, { lang })} {lang === 'bn' ? 'দিন বাকি' : 'days left'}
          </Chip>
        ) : null}
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b py-1" style={{ borderColor: 'var(--hairline)' }}>
            <dt style={{ color: 'var(--text-faint)' }}>{label}</dt>
            <dd className="tabular text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4" style={{ color: 'var(--text-faint)' }} aria-hidden />
        {tank.certificateImageUrl ? (
          <a
            href={tank.certificateImageUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium"
            style={{ color: 'var(--color-accent)' }}
            lang={lang}
          >
            {t('stock.certificate')}
          </a>
        ) : (
          <Muted lang={lang}>{t('stock.noCertificate')}</Muted>
        )}
      </div>
    </GlassCard>
  );
}
