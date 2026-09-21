import { ImageResponse } from 'next/og';

/**
 * The iOS home-screen icon.
 *
 * Safari ignores the manifest's icons and wants its own, always opaque and
 * always square — it applies its own rounding, so drawing corners here would
 * double them.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1e40af',
          color: '#ffffff',
        }}
      >
        <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1, display: 'flex' }}>JHM</div>
        <div
          style={{
            marginTop: 12,
            width: 70,
            height: 5,
            background: '#ffffff',
            opacity: 0.85,
            borderRadius: 999,
            display: 'flex',
          }}
        />
      </div>
    ),
    size,
  );
}
