import { Download } from 'lucide-react'
import { useState } from 'react'
import { ScanCalendar } from './ScanCalendar'
import type { Cabin, ScanPeriod, SearchRequest, TripOption, TripScanResponse } from './types'

export interface ScanSettings {
  paymentMode: 'miles' | 'cash'
  period: ScanPeriod
  /** null = any stay length. */
  stayNights: number | null
}

const periods: Array<[ScanPeriod, string]> = [['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['12m', '12 months']]
const stayPresets: Array<number | null> = [null, 7, 14, 21, 30]
const cabinLabels: Record<Cabin, string> = { ECONOMY: 'Economy', PREMIUM: 'Premium', BUSINESS: 'Business' }

const numberFmt = new Intl.NumberFormat('en-GB')
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
      <span>Price in</span>
      <div className="segmented-control scan-two">
        {([['miles', 'Miles (Flying Blue)'], ['cash', 'Euros']] as const).map(([paymentMode, label]) => (
          <button key={paymentMode} type="button" className={settings.paymentMode === paymentMode ? 'active' : ''} onClick={() => onSettings({ ...settings, paymentMode })}>{label}</button>
        ))}
      </div>
    </div>

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
      {settings.paymentMode === 'miles' && <label><span>Mile value</span><div className="compact-input"><input type="number" min="0.1" max="10" step="0.1" value={request.mileValueCents} onChange={(event) => patchRequest('mileValueCents', Number(event.target.value) || 1)} /><small>ct</small></div></label>}
    </div>
  </div>
}

type ScanView = 'calendar' | 'price' | 'value' | 'outbound'

const csvFor = (response: TripScanResponse): string => {
  const back = new Map((response.inbound ?? []).map((day) => [day.date, day]))
  const dates = [...new Set([...response.outbound.map((day) => day.date), ...back.keys()])].sort()
  const out = new Map(response.outbound.map((day) => [day.date, day]))
  const rows = dates.map((date) => [date, out.get(date)?.price ?? '', out.get(date)?.taxes ?? '', back.get(date)?.price ?? '', back.get(date)?.taxes ?? ''].join(','))
  return ['date,outbound_miles,outbound_taxes_eur,return_miles,return_taxes_eur', ...rows].join('\n')
}

const downloadCsv = (response: TripScanResponse, route: string) => {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csvFor(response)], { type: 'text/csv' }))
  link.download = `miles-${route}-${response.from}-${response.to}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

function TripTable({ trips, oneWay, miles }: { trips: TripOption[]; oneWay: boolean; miles: boolean }) {
  const price = (value: number) => (miles ? numberFmt.format(value) : euros.format(value))
  if (!trips.length) return <p className="scan-empty">No award seats found for these dates.</p>
  return <table className="scan-table">
    <thead><tr><th>Outbound</th>{!oneWay && <><th>Return</th><th>Nights</th></>}<th className="num">{miles ? 'Miles' : 'Fare'}</th>{miles && <><th className="num">Taxes</th><th className="num">Value</th></>}</tr></thead>
    <tbody>{trips.map((trip) => (
      <tr key={`${trip.outboundDate}-${trip.returnDate ?? ''}`}>
        <td>{formatDay(trip.outboundDate)}<small>{price(trip.outboundPrice)}</small></td>
        {!oneWay && <><td>{formatDay(trip.returnDate)}<small>{trip.returnPrice != null ? price(trip.returnPrice) : ''}</small></td><td>{trip.nights}</td></>}
        <td className="num strong">{price(trip.totalPrice)}</td>
        {miles && <><td className="num">{euros.format(trip.totalTaxes)}</td><td className="num">{euros.format(trip.valueEur)}</td></>}
      </tr>
    ))}</tbody>
  </table>
}

export function ScanResults({ response, request, stayNights }: { response: TripScanResponse; request: SearchRequest; stayNights: number | null }) {
  const oneWay = !response.inbound
  const [view, setView] = useState<ScanView>('calendar')
  const miles = response.currency === 'MILES'
  const route = `${request.origin.code}-${request.destination.code}`
  return <section className="scan-results">
    <div className="result-toolbar">
      <div className="view-tabs">
        <button type="button" className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>Calendar</button>
        <button type="button" className={view === 'price' ? 'active' : ''} onClick={() => setView('price')}>{miles ? 'Fewest miles' : 'Lowest fare'}</button>
        {miles && <button type="button" className={view === 'value' ? 'active' : ''} onClick={() => setView('value')}>Best value</button>}
        {!oneWay && <button type="button" className={view === 'outbound' ? 'active' : ''} onClick={() => setView('outbound')}>Cheapest outbound + returns</button>}
      </div>
      <button type="button" className="scan-csv" onClick={() => downloadCsv(response, route)}><Download size={14} /> Every day (CSV)</button>
    </div>
    <p className="scan-note">
      {formatDay(response.from)} to {formatDay(response.to)} · {response.outbound.length} outbound days{oneWay ? '' : ` · ${response.inbound?.length ?? 0} return days`} · {response.requests} Air France calls in {Math.round(response.durationMs / 1000)} s.
      {!oneWay && (miles ? ' Totals add two one-way awards.' : ' Totals add two one-way fares; a return ticket can be cheaper.')}
    </p>
    {view === 'calendar' && <ScanCalendar response={response} request={request} stayNights={stayNights} />}
    {view === 'price' && <TripTable trips={response.byPrice} oneWay={oneWay} miles={miles} />}
    {view === 'value' && <TripTable trips={response.byValue} oneWay={oneWay} miles={miles} />}
    {view === 'outbound' && <div className="scan-groups">
      {response.byOutbound.map((group) => (
        <div className="scan-group" key={group.outbound.date}>
          <div className="scan-group-head"><strong>{formatDay(group.outbound.date)}</strong><span>{miles ? `${numberFmt.format(group.outbound.price)} miles · ${euros.format(group.outbound.taxes ?? 0)}` : euros.format(group.outbound.price)}</span></div>
          <TripTable trips={group.returns} oneWay={false} miles={miles} />
        </div>
      ))}
    </div>}
  </section>
}
