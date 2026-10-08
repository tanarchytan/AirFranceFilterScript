import { Download } from 'lucide-react'
import { useState } from 'react'
import type { Cabin, ScanPeriod, SearchRequest, TripOption, TripScanResponse } from './types'

export interface ScanSettings {
  period: ScanPeriod
  /** null = any stay length. */
  stayNights: number | null
}

export const initialScanSettings: ScanSettings = { period: 'quarter', stayNights: null }

const periods: Array<[ScanPeriod, string]> = [['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['12m', '12 months']]
const stayPresets: Array<number | null> = [null, 7, 14, 21, 30]
const cabinLabels: Record<Cabin, string> = { ECONOMY: 'Economy', PREMIUM: 'Premium', BUSINESS: 'Business' }

const miles = new Intl.NumberFormat('en-GB')
const euros = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const dayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDay = (iso?: string) => (iso ? dayLabel.format(new Date(`${iso}T00:00:00Z`)) : '—')

interface ScanControlsProps {
  settings: ScanSettings
  onSettings: (settings: ScanSettings) => void
  request: SearchRequest
  patchRequest: <K extends keyof SearchRequest>(key: K, value: SearchRequest[K]) => void
}

export function ScanControls({ settings, onSettings, request, patchRequest }: ScanControlsProps) {
  const custom = settings.stayNights != null && !stayPresets.includes(settings.stayNights)
  return <div className="scan-controls">
    <div className="mode-section">
      <span>Trip</span>
      <div className="segmented-control scan-two">
        {([['return', 'Return'], ['oneway', 'One-way']] as const).map(([tripType, label]) => (
          <button key={tripType} type="button" className={request.tripType === tripType ? 'active' : ''} onClick={() => patchRequest('tripType', tripType)}>{label}</button>
        ))}
      </div>
    </div>

    <div className="mode-section">
      <span>Outbound in</span>
      <div className="scan-chips">
        {periods.map(([period, label]) => (
          <button key={period} type="button" className={settings.period === period ? 'active' : ''} onClick={() => onSettings({ ...settings, period })}>{label}</button>
        ))}
      </div>
    </div>

    {request.tripType === 'return' && <div className="mode-section">
      <span>Stay</span>
      <div className="scan-chips">
        {stayPresets.map((nights) => (
          <button key={nights ?? 'any'} type="button" className={settings.stayNights === nights ? 'active' : ''} onClick={() => onSettings({ ...settings, stayNights: nights })}>{nights == null ? 'Any' : `${nights} nights`}</button>
        ))}
        <label className={`scan-custom ${custom ? 'active' : ''}`}>
          <input type="number" min="1" max="60" placeholder="Other" value={custom ? settings.stayNights ?? '' : ''}
            onChange={(event) => {
              const value = Math.round(Number(event.target.value))
              onSettings({ ...settings, stayNights: value >= 1 && value <= 60 ? value : null })
            }} />
          <small>nights</small>
        </label>
      </div>
    </div>}

    <div className="field-row scan-row">
      <label><span>Adults</span><div className="compact-input"><input type="number" min="1" max="9" value={request.adults} onChange={(event) => patchRequest('adults', Math.min(9, Math.max(1, Number(event.target.value) || 1)))} /></div></label>
      <label><span>Cabin</span><div className="compact-input"><select value={request.cabins[0]} onChange={(event) => patchRequest('cabins', [event.target.value as Cabin])}>
        {(Object.keys(cabinLabels) as Cabin[]).map((cabin) => <option key={cabin} value={cabin}>{cabinLabels[cabin]}</option>)}
      </select></div></label>
      <label><span>Mile value</span><div className="compact-input"><input type="number" min="0.1" max="10" step="0.1" value={request.mileValueCents} onChange={(event) => patchRequest('mileValueCents', Number(event.target.value) || 1)} /><small>ct</small></div></label>
    </div>
  </div>
}

type ScanView = 'miles' | 'value' | 'outbound'

const csvFor = (response: TripScanResponse): string => {
  const back = new Map((response.inbound ?? []).map((day) => [day.date, day]))
  const dates = [...new Set([...response.outbound.map((day) => day.date), ...back.keys()])].sort()
  const out = new Map(response.outbound.map((day) => [day.date, day]))
  const rows = dates.map((date) => [date, out.get(date)?.miles ?? '', out.get(date)?.taxes ?? '', back.get(date)?.miles ?? '', back.get(date)?.taxes ?? ''].join(','))
  return ['date,outbound_miles,outbound_taxes_eur,return_miles,return_taxes_eur', ...rows].join('\n')
}

const downloadCsv = (response: TripScanResponse, route: string) => {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csvFor(response)], { type: 'text/csv' }))
  link.download = `miles-${route}-${response.from}-${response.to}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

function TripTable({ trips, oneWay }: { trips: TripOption[]; oneWay: boolean }) {
  if (!trips.length) return <p className="scan-empty">No award seats found for these dates.</p>
  return <table className="scan-table">
    <thead><tr><th>Outbound</th>{!oneWay && <><th>Return</th><th>Nights</th></>}<th className="num">Miles</th><th className="num">Taxes</th><th className="num">Value</th></tr></thead>
    <tbody>{trips.map((trip) => (
      <tr key={`${trip.outboundDate}-${trip.returnDate ?? ''}`}>
        <td>{formatDay(trip.outboundDate)}<small>{miles.format(trip.outboundMiles)}</small></td>
        {!oneWay && <><td>{formatDay(trip.returnDate)}<small>{trip.returnMiles != null ? miles.format(trip.returnMiles) : ''}</small></td><td>{trip.nights}</td></>}
        <td className="num strong">{miles.format(trip.totalMiles)}</td>
        <td className="num">{euros.format(trip.totalTaxes)}</td>
        <td className="num">{euros.format(trip.valueEur)}</td>
      </tr>
    ))}</tbody>
  </table>
}

export function ScanResults({ response, request }: { response: TripScanResponse; request: SearchRequest }) {
  const oneWay = !response.inbound
  const [view, setView] = useState<ScanView>('miles')
  const route = `${request.origin.code}-${request.destination.code}`
  return <section className="scan-results">
    <div className="result-toolbar">
      <div className="view-tabs">
        <button type="button" className={view === 'miles' ? 'active' : ''} onClick={() => setView('miles')}>Fewest miles</button>
        <button type="button" className={view === 'value' ? 'active' : ''} onClick={() => setView('value')}>Best value</button>
        {!oneWay && <button type="button" className={view === 'outbound' ? 'active' : ''} onClick={() => setView('outbound')}>Cheapest outbound + returns</button>}
      </div>
      <button type="button" className="scan-csv" onClick={() => downloadCsv(response, route)}><Download size={14} /> Every day (CSV)</button>
    </div>
    <p className="scan-note">
      {formatDay(response.from)} to {formatDay(response.to)} · {response.outbound.length} outbound days{oneWay ? '' : ` · ${response.inbound?.length ?? 0} return days`} · {response.requests} Air France calls in {Math.round(response.durationMs / 1000)} s.
      {!oneWay && ' Totals add two one-way awards; check the exact price before booking.'}
    </p>
    {view === 'miles' && <TripTable trips={response.byMiles} oneWay={oneWay} />}
    {view === 'value' && <TripTable trips={response.byValue} oneWay={oneWay} />}
    {view === 'outbound' && <div className="scan-groups">
      {response.byOutbound.map((group) => (
        <div className="scan-group" key={group.outbound.date}>
          <div className="scan-group-head"><strong>{formatDay(group.outbound.date)}</strong><span>{miles.format(group.outbound.miles)} miles · {euros.format(group.outbound.taxes ?? 0)}</span></div>
          <TripTable trips={group.returns} oneWay={false} />
        </div>
      ))}
    </div>}
  </section>
}
