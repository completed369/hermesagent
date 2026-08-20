const DEFAULT_ACCENT = '#5b8def';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const TARGET_TEXT_CONTRAST = 4.5;

type Rgb = readonly [number, number, number];

export interface AccentTokens {
  brand: string;
  readableOnDark: string;
  readableOnLight: string;
}

function parseHex(value: string): Rgb {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function toHex([red, green, blue]: Rgb): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseHex(foreground));
  const backgroundLuminance = relativeLuminance(parseHex(background));
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function mix(source: Rgb, target: Rgb, amount: number): Rgb {
  return source.map((channel, index) =>
    Math.round(channel + (target[index]! - channel) * amount),
  ) as unknown as Rgb;
}

function makeReadable(accent: string, backgrounds: readonly string[], target: Rgb): string {
  const source = parseHex(accent);

  for (let step = 0; step <= 100; step += 1) {
    const candidate = toHex(mix(source, target, step / 100));
    if (
      backgrounds.every(
        (background) => contrastRatio(candidate, background) >= TARGET_TEXT_CONTRAST,
      )
    ) {
      return candidate;
    }
  }

  return toHex(target);
}

/**
 * Keeps the workspace-selected colour for decorative surfaces while deriving
 * semantic text/focus tokens that remain readable in either OS colour theme.
 */
export function deriveAccentTokens(value: string): AccentTokens {
  const brand = HEX_COLOR.test(value) ? value.toLowerCase() : DEFAULT_ACCENT;

  return {
    brand,
    readableOnDark: makeReadable(brand, ['#0b0e14', '#131722'], [255, 255, 255]),
    readableOnLight: makeReadable(brand, ['#f5f6f8', '#ffffff'], [0, 0, 0]),
  };
}
