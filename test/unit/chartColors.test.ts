import { describe, expect, it } from 'vitest';
import { contrastRatio, parseCssColor, type DarkPalette, type Rgb } from '../../src/shared/color';
import { adaptChartOption } from '../../src/webview/pptx/chartColors';

const hex = (value: string) => parseCssColor(value) as Rgb;

// VS Code Dark Modern
const palette: DarkPalette = { background: hex('#1f1f1f'), foreground: hex('#cccccc') };

/** A trimmed version of what ECharts' getOption() returns for a PowerPoint bar chart. */
function barChart() {
  const labelFormatter = (value: unknown) => String(value);
  const bars = {
    type: 'bar',
    data: [1240, 980],
    itemStyle: { color: '#4472C4', borderColor: '#000000' },
    label: { color: '#000000', position: 'insideTop' },
  };
  const line = {
    type: 'line',
    data: [{ value: 1385, itemStyle: { color: '#ED7D31' }, label: { color: '#000000' } }],
    lineStyle: { color: '#ED7D31' },
    label: { color: '#000000', position: 'top' },
  };
  return {
    color: ['#4472C4', '#ED7D31'],
    backgroundColor: '#FFFFFF',
    title: [{ text: 'Revenue', textStyle: { color: '#000000', rich: { r0: { color: '#000' } } } }],
    xAxis: [
      {
        type: 'category',
        data: ['North', 'South'],
        axisLabel: { color: '#404040', formatter: labelFormatter },
        axisLine: { lineStyle: { color: '#888888' } },
      },
    ],
    yAxis: [{ splitLine: { lineStyle: { color: '#D9D9D9' } } }],
    grid: [{ backgroundColor: 'rgba(0,0,0,0)', borderColor: '#B7B9BE' }],
    tooltip: [{ backgroundColor: '#fff', textStyle: { color: '#000' } }],
    series: [bars, line] as [typeof bars, typeof line],
  };
}

describe('adaptChartOption', () => {
  const adapted = adaptChartOption(barChart(), palette) as ReturnType<typeof barChart>;
  const readable = (value: string) => contrastRatio(hex(value), palette.background) >= 4.5;

  it('makes chart text readable on the dark slide', () => {
    expect(readable(adapted.title[0].textStyle.color)).toBe(true);
    expect(readable(adapted.title[0].textStyle.rich.r0.color)).toBe(true);
    expect(readable(adapted.xAxis[0].axisLabel.color)).toBe(true);
    expect(readable(adapted.series[1].label.color)).toBe(true);
    expect(readable(adapted.series[1].data[0].label.color)).toBe(true);
  });

  it('darkens the chart background and keeps a transparent plot area transparent', () => {
    expect(hex(adapted.backgroundColor)).toEqual(palette.background);
    expect(adapted.grid[0].backgroundColor).toBe('rgba(0,0,0,0)');
  });

  it('keeps faint gridlines faint and axis lines clear', () => {
    const contrast = (value: string) => contrastRatio(hex(value), palette.background);
    const gridline = contrast(adapted.yAxis[0].splitLine.lineStyle.color);
    const axis = contrast(adapted.xAxis[0].axisLine.lineStyle.color);
    expect(gridline).toBeLessThan(2);
    expect(axis).toBeGreaterThan(gridline);
    expect(axis).toBeGreaterThan(1.5);
  });

  it('keeps the data colors, so series still match the legend', () => {
    expect(adapted.color).toEqual(['#4472C4', '#ED7D31']);
    expect(adapted.series[0].itemStyle.color).toBe('#4472C4');
    expect(adapted.series[1].lineStyle.color).toBe('#ED7D31');
    expect(adapted.series[1].data[0].itemStyle.color).toBe('#ED7D31');
  });

  it('keeps labels drawn on top of the bars as they are', () => {
    expect(adapted.series[0].label.color).toBe('#000000');
  });

  it('leaves tooltips, data and functions alone', () => {
    expect(adapted.tooltip).toEqual(barChart().tooltip);
    expect(adapted.series[0].data).toEqual([1240, 980]);
    expect(adapted.xAxis[0].data).toEqual(['North', 'South']);
    expect(typeof adapted.xAxis[0].axisLabel.formatter).toBe('function');
  });
});
