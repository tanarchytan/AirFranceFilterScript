import {
  Activity, ArrowDownUp, ArrowRight, BarChart3, CalendarDays, CalendarRange, Check,
  CheckCircle2, ChevronDown, CircleAlert, Clock3, Coins, Copy, Database,
  ExternalLink, Gauge, Info, Luggage, MapPin, Plane, Radar, RefreshCw,
  Route, ScanSearch, Search, ShieldCheck, SlidersHorizontal, Sparkles, TicketCheck,
  TimerReset, Users, X, Zap,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthPrompt } from './AuthPrompt'
import { initialScanSettings, ScanControls, ScanResults, type ScanSettings } from './ScanPanel'
import { formatDuration, rankOffers } from './lib/optimizer'
import { matchStationQuery, stationLabel } from './lib/stations'
import type { Cabin, ExploreFare, ExploreResponse, RankedOffer, SearchRequest, SearchResponse, Station, TripScanResponse } from './types'

const cabinLabels: Record<Cabin, string> = {
  ECONOMY: 'Economy',
  PREMIUM: 'Premium',
  BUSINESS: 'Business',
}

const initialOrigin: Station = {
  code: 'AMS', cityCode: 'AMS', cityName: 'Amsterdam', countryName: 'Netherlands',
  displayText: 'Amsterdam, Schiphol Airport', stationType: 'AIRPORT', isOrigin: true, isDestination: true,
}
const initialDestination: Station = {
  code: '', cityCode: '', cityName: '', countryName: '',
  displayText: '', stationType: 'AIRPORT', isOrigin: true, isDestination: true,
}

const dateOffset = (days: number) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const initialRequest: SearchRequest = {
  origin: initialOrigin,
  destination: initialDestination,
  tripType: 'return',
  departureDate: dateOffset(45),
  returnDate: dateOffset(55),
  flexibleDays: 3,
  tripLengthDays: 10,
  cabins: ['ECONOMY'],
  paymentMode: 'cash',
  adults: 1,
  maxStops: 2,
  maxDurationHours: 36,
  nearbyAirports: true,
  separateTickets: false,
  longLayover: false,
  mileValueCents: 1.2,
}

const cashFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
})
const milesFormatter = new Intl.NumberFormat('en-GB')
const verifiedDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})
const flightDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
})

const formatCash = (value?: number) => value == null ? '—' : cashFormatter.format(value)
const formatMiles = (value?: number) => value == null ? '—' : `${milesFormatter.format(value)} M`
const dateTimeLabel = (value: string) => verifiedDateFormatter.format(new Date(value))
const flightDateLabel = (value: string) => value ? flightDateFormatter.format(new Date(value)) : '—'
const readableDate = (value: string) => value.split('-').reverse().join('/')
const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const addIsoDays = (isoDate: string, days: number) => {
  if (!isIsoDate(isoDate)) return isoDate
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function SafeDateInput({
  value,
  min,
  disabled = false,
  onCommit,
}: {
  value: string
  min?: string
  disabled?: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  return <input
    type="date"
    value={draft}
    min={min}
    disabled={disabled}
    onChange={(event) => {
      const next = event.target.value
      setDraft(next)
      if (isIsoDate(next)) onCommit(next)
    }}
    onBlur={() => { if (!isIsoDate(draft)) setDraft(value) }}
  />
}

interface StationAutocompleteProps {
  label: string
  value: Station
  onChange: (station: Station) => void
  destination?: boolean
  onPendingChange?: (pending: boolean) => void
}

function StationAutocomplete({ label, value, onChange, destination = false, onPendingChange }: StationAutocompleteProps) {
  const [query, setQuery] = useState(stationLabel(value))
  const [options, setOptions] = useState<Station[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [selectionError, setSelectionError] = useState(false)

  useEffect(() => {
    const clean = query.replace(/\([^)]*\)/g, '').trim()
    if (!open || clean.length < 2) return
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setFetchError(false)
      try {
        const response = await fetch(`/api/stations?q=${encodeURIComponent(clean)}`, { signal: controller.signal })
        const payload = await response.json() as { results: Station[]; error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Reference service unavailable')
        setOptions(payload.results.filter((station) => destination ? station.isDestination : station.isOrigin))
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setOptions([])
        setFetchError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 180)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [destination, open, query])

  const select = (station: Station) => {
    onChange(station)
    onPendingChange?.(false)
    setSelectionError(false)
    setQuery(stationLabel(station))
    setOpen(false)
  }

  const resolveQuery = async () => {
    const localMatch = matchStationQuery(query, options)
    if (localMatch) return select(localMatch)
    const clean = query.replace(/\([^)]*\)/g, '').trim()
    if (clean.length < 2) {
      setSelectionError(true)
      return
    }
    try {
      const response = await fetch(`/api/stations?q=${encodeURIComponent(clean)}`)
      const payload = await response.json() as { results: Station[] }
      const eligible = payload.results.filter((station) => destination ? station.isDestination : station.isOrigin)
      const remoteMatch = matchStationQuery(query, eligible)
      if (remoteMatch) return select(remoteMatch)
    } catch {
      setFetchError(true)
    }
    setSelectionError(true)
    setOpen(true)
  }

  return (
    <div className="station-field">
      <label>{label}</label>
      <div className="station-input-wrap">
        <MapPin size={17} aria-hidden="true" />
        <input
          value={query}
          placeholder={destination ? 'City or destination code' : 'City or origin code'}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectionError(false)
            onPendingChange?.(true)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => { void resolveQuery(); setOpen(false) }, 130)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void resolveQuery()
          }}
          aria-invalid={selectionError}
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
        />
        <span className="station-code">{value.code}</span>
      </div>
      {open && (
        <div className="station-options" role="listbox">
          {loading && <div className="station-loading"><RefreshCw className="spin" size={15} /> Air France reference data</div>}
          {!loading && fetchError && <div className="station-empty"><CircleAlert size={14} /> Air France is not responding</div>}
          {!loading && !fetchError && options.map((station) => (
            <button key={`${station.code}-${station.stationType}`} type="button" role="option" onMouseDown={() => select(station)}>
              <span className="option-code">{station.code}</span>
              <span><strong>{station.cityName}</strong><small>{station.countryName} · {station.stationType === 'CITY' ? 'All airports' : station.displayText.split(',').at(-1)}</small></span>
            </button>
          ))}
          {!loading && !fetchError && options.length === 0 && <div className="station-empty">No matching airport</div>}
        </div>
      )}
      {selectionError && <span className="station-validation"><CircleAlert size={12} /> Pick an Air France suggestion</span>}
    </div>
  )
}

function RouteRibbon({ offer, baseline }: { offer: RankedOffer; baseline?: number }) {
  const isDetour = offer.stops > 1
  const cash = offer.selectedPrice.cash
  const delta = baseline != null && cash != null ? cash - baseline : undefined
  return (
    <div className={`route-ribbon ${isDetour ? 'is-detour' : ''}`}>
      <div className="route-track" aria-label={`Route ${offer.route.join(' to ')}`}>
        {offer.route.map((code, index) => (
          <div className="route-stop" key={`${code}-${index}`}>
            <span className="route-node">{index === 0 ? <Plane size={14} /> : index === offer.route.length - 1 ? <MapPin size={14} /> : <span />}</span>
            <strong>{code}</strong>
            {index < offer.route.length - 1 && <span className="route-line" />}
          </div>
        ))}
      </div>
      {delta != null && <div className={`route-delta ${delta <= 0 ? 'positive' : ''}`}>
        {delta === 0 ? 'Baseline' : `${delta > 0 ? '+' : '−'}${formatCash(Math.abs(delta))}`}
      </div>}
    </div>
  )
}

const OfferRow = memo(function OfferRow({ offer, baseline }: { offer: RankedOffer; baseline?: number }) {
  const [expanded, setExpanded] = useState(false)
  const carrier = Array.from(new Set(offer.segments.map((segment) => segment.carrier))).join(' + ')
  return (
    <article className={`offer-row ${offer.paretoOptimal ? 'is-pareto' : ''} ${expanded ? 'is-expanded' : ''}`} id={`offer-${offer.id}`}>
      <button type="button" className="offer-main" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <div className="offer-carrier">
          <span className="carrier-mark">{carrier.split(' ').map((word) => word[0]).slice(0, 2).join('')}</span>
          <span><strong>{carrier}</strong><small>Air France ticket</small></span>
        </div>
        <div className="offer-route-cell">
          <RouteRibbon offer={offer} baseline={baseline} />
          <span className="offer-times">{offer.segments[0]?.departure || '—'} <ArrowRight size={13} /> {offer.segments.at(-1)?.arrival || '—'}</span>
        </div>
        <div className="offer-metrics">
          <span><Clock3 size={14} /> {formatDuration(offer.totalDurationMinutes)}</span>
          <span>{offer.stops === 0 ? 'Direct' : `${offer.stops} stop${offer.stops > 1 ? 's' : ''}`}</span>
        </div>
        <div className="offer-pricing">
          <span className="cabin-label">{cabinLabels[offer.selectedPrice.cabin]}</span>
          <strong>{formatCash(offer.selectedPrice.cash)}</strong>
          <small>{offer.selectedPrice.miles ? `${formatMiles(offer.selectedPrice.miles)} + ${formatCash(offer.selectedPrice.taxes)}` : 'Miles not exposed'}</small>
        </div>
        <div className="score-cell">
          <span className={`risk-dot risk-${offer.risk}`} title={`Risk ${offer.risk}`} />
          <strong>{offer.dealScore}</strong><small>score</small>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
      </button>
      <div className="offer-badges">
        {offer.departureDate && <span>{readableDate(offer.departureDate)}{offer.returnDate ? ` → ${readableDate(offer.returnDate)}` : ''}</span>}
        {offer.badges.map((badge) => <span key={badge}>{badge}</span>)}
        {offer.paretoOptimal && <span className="pareto-badge"><Sparkles size={12} /> Pareto</span>}
      </div>
      {expanded && (
        <div className="offer-detail">
          <div className="segment-timeline">
            {offer.segments.map((segment, index) => (
              <div className="segment" key={`${segment.from}-${segment.to}-${index}`}>
                <div className="segment-dot" />
                <div className="segment-copy">
                  <strong>{segment.from} <ArrowRight size={13} /> {segment.to}</strong>
                  <small>{segment.flightNumber || segment.carrier}{segment.aircraft ? ` · ${segment.aircraft}` : ''}</small>
                  <small>{flightDateLabel(segment.departure)} → {flightDateLabel(segment.arrival)}{segment.durationMinutes ? ` · ${formatDuration(segment.durationMinutes)}` : ''}</small>
                  {segment.operatingCarrier && segment.operatingCarrier !== segment.carrier && <small>Operated by {segment.operatingCarrier}{segment.operatingFlightNumber ? ` · ${segment.operatingFlightNumber}` : ''}</small>}
                  {segment.layoverAfterMinutes != null && <small className="layover-line">Layover {formatDuration(segment.layoverAfterMinutes)}</small>}
                </div>
              </div>
            ))}
          </div>
          <div className="fare-facts">
            <span><TicketCheck size={15} /> Fare captured from Air France</span>
            <span><Luggage size={15} /> {offer.bagsIncluded == null ? 'Check baggage' : offer.bagsIncluded ? 'Baggage included' : 'Baggage not included'}</span>
            <span><ShieldCheck size={15} /> {offer.singleTicket ? 'Protected connections' : 'Separate tickets'}</span>
          </div>
          <div className="cabin-grid">
            {offer.prices.map((price) => (
              <div key={price.cabin}>
                <span>{cabinLabels[price.cabin]}</span>
                <strong>{formatCash(price.cash)}</strong>
                <small>{price.miles ? `${formatMiles(price.miles)}${price.taxes ? ` + ${formatCash(price.taxes)}` : ''}` : 'Miles not exposed'}</small>
                <small>{[price.fareFamily, price.seatsAvailable != null ? `${price.seatsAvailable} seat${price.seatsAvailable > 1 ? 's' : ''}` : undefined].filter(Boolean).join(' · ') || 'Inventory not exposed'}</small>
              </div>
            ))}
          </div>
          <a className="af-link" href="https://wwws.airfrance.fr/" target="_blank" rel="noreferrer">
            Open Air France <ExternalLink size={14} />
          </a>
        </div>
      )}
    </article>
  )
})

function FrontierChart({ offers }: { offers: RankedOffer[] }) {
  const [selectedId, setSelectedId] = useState<string>()
  const cashOffers = offers.filter((offer) => offer.selectedPrice.cash != null)
  if (!cashOffers.length) return <div className="analysis-empty">The frontier will appear once Air France returns euro prices.</div>

  const width = 760
  const height = 250
  const inset = { top: 22, right: 34, bottom: 40, left: 58 }
  const durations = cashOffers.map((offer) => offer.totalDurationMinutes)
  const prices = cashOffers.map((offer) => offer.selectedPrice.cash!)
  const minDuration = Math.min(...durations)
  const maxDuration = Math.max(...durations)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const x = (duration: number) => inset.left + ((duration - minDuration) / Math.max(1, maxDuration - minDuration)) * (width - inset.left - inset.right)
  const y = (price: number) => height - inset.bottom - ((price - minPrice) / Math.max(1, maxPrice - minPrice)) * (height - inset.top - inset.bottom)
  const selected = cashOffers.find((offer) => offer.id === selectedId) ?? cashOffers.find((offer) => offer.paretoOptimal) ?? cashOffers[0]

  const focusOffer = (offer: RankedOffer) => {
    setSelectedId(offer.id)
    document.getElementById(`offer-${offer.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <section className="frontier-panel" aria-label="Price and duration frontier">
      <div className="frontier-heading">
        <div><span>Live frontier</span><strong>Price vs travel time</strong></div>
        <div className="frontier-legend"><span><i className="dot-pareto" /> Optimal</span><span><i /> Dominated</span></div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Scatter plot of offers by price and duration">
          {[0, 1, 2, 3].map((step) => {
            const lineY = inset.top + step * ((height - inset.top - inset.bottom) / 3)
            return <line key={step} x1={inset.left} x2={width - inset.right} y1={lineY} y2={lineY} className="chart-grid" />
          })}
          <text x={inset.left} y={height - 12} className="chart-label">{formatDuration(minDuration)}</text>
          <text x={width - inset.right} y={height - 12} textAnchor="end" className="chart-label">{formatDuration(maxDuration)}</text>
          <text x={8} y={inset.top + 4} className="chart-label">{formatCash(maxPrice)}</text>
          <text x={8} y={height - inset.bottom + 4} className="chart-label">{formatCash(minPrice)}</text>
          {cashOffers.map((offer) => (
            <g
              key={offer.id}
              role="button"
              tabIndex={0}
              aria-label={`${offer.route.join(' via ')}, ${formatCash(offer.selectedPrice.cash)}, ${formatDuration(offer.totalDurationMinutes)}`}
              onClick={() => focusOffer(offer)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') focusOffer(offer) }}
              className={`chart-point ${offer.paretoOptimal ? 'is-optimal' : ''} ${selected.id === offer.id ? 'is-selected' : ''}`}
            >
              <circle cx={x(offer.totalDurationMinutes)} cy={y(offer.selectedPrice.cash!)} r={selected.id === offer.id ? 8 : 6} />
            </g>
          ))}
        </svg>
      </div>
      <div className="chart-selection">
        <span>{selected.route.join(' · ')}</span>
        <strong>{formatCash(selected.selectedPrice.cash)}</strong>
        <small>{formatDuration(selected.totalDurationMinutes)} · {selected.stops === 0 ? 'direct' : `${selected.stops} stop${selected.stops > 1 ? 's' : ''}`} · score {selected.dealScore}</small>
      </div>
    </section>
  )
}

function MonthlyCalendar({
  items,
  request,
  onSelect,
}: {
  items: SearchResponse['monthlyCalendar']
  request: SearchRequest
  onSelect: (flightDate: string) => void
}) {
  if (!items.length) return <div className="analysis-empty">Air France returned no monthly lowest fares for this route.</div>
  const lowestCash = Math.min(...items.map((item) => item.cash ?? Infinity))
  const lowestMiles = Math.min(...items.map((item) => item.miles ?? Infinity))
  const bestCashMonths = items.filter((item) => item.cash === lowestCash)
  const bestMilesMonths = items.filter((item) => item.miles === lowestMiles)
  const tiedMonths = (best: typeof items) => best.length > 1 ? `${best[0].label} +${best.length - 1} tied` : best[0]?.label
  return (
    <section className="monthly-horizon" aria-label="Best Air France price by month">
      <div className="calendar-heading">
        <div><span>Open Dates · network horizon</span><strong>Best price of each month</strong></div>
        <small>{items.length} months available · return prices</small>
      </div>
      <div className="month-leaders" aria-label="Best months">
        {bestCashMonths[0]?.cashFlightDate && <button type="button" onClick={() => onSelect(bestCashMonths[0].cashFlightDate!)}>
          <span>Best month in euros</span><strong>{formatCash(lowestCash)}</strong><small>{tiedMonths(bestCashMonths)} · {readableDate(bestCashMonths[0].cashFlightDate)}</small><ArrowRight size={15} />
        </button>}
        {bestMilesMonths[0]?.milesFlightDate && <button type="button" className="miles" onClick={() => onSelect(bestMilesMonths[0].milesFlightDate!)}>
          <span>Best month in Miles</span><strong>{formatMiles(lowestMiles)}</strong><small>{tiedMonths(bestMilesMonths)} · {readableDate(bestMilesMonths[0].milesFlightDate)}</small><ArrowRight size={15} />
        </button>}
      </div>
      <div className="month-grid">
        {items.map((item) => {
          const bestCash = item.cash != null && item.cash === lowestCash
          const bestMiles = item.miles != null && item.miles === lowestMiles
          const selected = item.month === request.departureDate.slice(0, 7)
          return <div className={`month-cell ${selected ? 'is-selected' : ''} ${bestCash || bestMiles ? 'is-cheapest' : ''}`} key={item.month}>
            <span className="month-name">{item.label}</span>
            <span className="month-prices">
              {item.cash != null && item.cashFlightDate && <button type="button" className={bestCash ? 'is-best' : ''} onClick={() => onSelect(item.cashFlightDate!)}>
                <span><strong>{formatCash(item.cash)}</strong><small>Return · {readableDate(item.cashFlightDate)}</small></span><ArrowRight size={12} />
              </button>}
              {item.miles != null && item.milesFlightDate && <button type="button" className={`miles-price ${bestMiles ? 'is-best' : ''}`} onClick={() => onSelect(item.milesFlightDate!)}>
                <span><strong>{formatMiles(item.miles)}</strong><small>Return · {readableDate(item.milesFlightDate)}</small></span><ArrowRight size={12} />
              </button>}
            </span>
            <span className="month-action">{bestCash || bestMiles ? [bestCash ? 'Lowest €' : '', bestMiles ? 'Lowest Miles' : ''].filter(Boolean).join(' · ') : 'Return repricing'}</span>
          </div>
        })}
      </div>
      <div className="calendar-proof"><CheckCircle2 size={14} /> Planchers `SharedSearchLowestFareOffersForSearchQuery: MONTH` · € and Miles dates kept separate</div>
    </section>
  )
}

function FareCalendar({ items, request }: { items: SearchResponse['fareCalendar']; request: SearchRequest }) {
  if (!items.length) return <div className="analysis-empty">Air France returned no fare window for this search.</div>
  const comparable = (item: SearchResponse['fareCalendar'][number]) => {
    if (request.paymentMode === 'cash') return item.cash ?? Infinity
    if (request.paymentMode === 'miles') return item.miles ?? Infinity
    return Math.min(item.cash ?? Infinity, item.miles == null ? Infinity : item.miles * request.mileValueCents / 100 + (item.taxes ?? 0))
  }
  const values = items.map(comparable).filter(Number.isFinite)
  const min = Math.min(...values)
  const max = Math.max(...values)
  return (
    <section className="fare-calendar" aria-label="Date pairs priced by Air France">
      <div className="calendar-heading">
        <div><span>Exact Air France pricing</span><strong>{request.tripType === 'oneway' ? 'One-way' : `${request.tripLengthDays} days on site`}</strong></div>
        <small>{items.length} pair{items.length > 1 ? 's' : ''} verified · window ±{request.flexibleDays} d</small>
      </div>
      <div className="calendar-bars">
        {items.map((item) => {
          const value = comparable(item)
          const height = 35 + ((value - min) / Math.max(1, max - min)) * 100
          return <div className={`calendar-day ${value === min ? 'is-cheapest' : ''} ${item.selected ? 'is-selected' : ''}`} key={`${item.departureDate}-${item.returnDate}`}>
            <strong>{item.cash != null ? formatCash(item.cash) : formatMiles(item.miles)}</strong>
            <div className="calendar-bar-track"><span style={{ height }} /></div>
            <small>{item.label}{item.miles != null && item.cash != null ? ` · ${formatMiles(item.miles)}` : ''}</small>
            {value === min && <em>Best pair</em>}
          </div>
        })}
      </div>
      <div className="calendar-proof"><CheckCircle2 size={14} /> Each bar comes from an exact return `SearchResultAvailableOffersQuery`</div>
    </section>
  )
}

function ExploreTop3({
  fares,
  mode,
  onSelect,
}: {
  fares: ExploreFare[]
  mode: 'cash' | 'miles'
  onSelect: (date: string, mode: 'cash' | 'miles') => void
}) {
  if (!fares.length) return <span className="explore-missing">—</span>
  return <div className={`explore-top3 ${mode}`}>
    {fares.map((fare, index) => <button type="button" key={`${mode}-${fare.date}`} onClick={() => onSelect(fare.date, mode)}>
      <span className="explore-rank">{index + 1}</span>
      <span><strong>{mode === 'cash' ? formatCash(fare.price) : formatMiles(fare.price)}</strong><small>{readableDate(fare.date)}{mode === 'miles' && fare.taxes != null ? ` · +${formatCash(fare.taxes)}` : ''}</small></span>
      <ArrowRight size={12} />
    </button>)}
  </div>
}

function ExploreCalendar({
  response,
  paymentMode,
  onSelect,
}: {
  response: ExploreResponse
  paymentMode: 'cash' | 'both'
  onSelect: (date: string, mode: 'cash' | 'miles') => void
}) {
  const showMiles = paymentMode === 'both'
  const cashFares = response.months.flatMap((month) => month.cashTop3.map((fare) => ({ ...fare, month: month.label })))
  const milesFares = response.months.flatMap((month) => month.milesTop3.map((fare) => ({ ...fare, month: month.label })))
  const bestCash = cashFares.sort((left, right) => left.price - right.price)[0]
  const bestMiles = milesFares.sort((left, right) => left.price - right.price)[0]
  return <section className={`explore-calendar ${showMiles ? '' : 'cash-only'}`} aria-label="Air France monthly top 3">
    <div className="explore-summary">
      {bestCash && <button type="button" onClick={() => onSelect(bestCash.date, 'cash')}><span>Yearly minimum in euros</span><strong>{formatCash(bestCash.price)}</strong><small>{bestCash.month} · {readableDate(bestCash.date)}</small><ArrowRight size={15} /></button>}
      {showMiles && bestMiles && <button type="button" className="miles" onClick={() => onSelect(bestMiles.date, 'miles')}><span>Yearly minimum in Miles</span><strong>{formatMiles(bestMiles.price)}</strong><small>{bestMiles.month} · {readableDate(bestMiles.date)}{bestMiles.taxes != null ? ` · +${formatCash(bestMiles.taxes)}` : ''}</small><ArrowRight size={15} /></button>}
    </div>
    <div className="explore-table-head"><span>Month</span><span>Top 3 euros · return</span>{showMiles && <span>Top 3 Miles · return</span>}</div>
    <div className="explore-months">
      {response.months.map((month) => <div className="explore-month" key={month.month}>
        <div className="explore-month-name"><span>{month.label}</span><small>{month.cashTop3.length + month.milesTop3.length} live fares</small></div>
        <ExploreTop3 fares={month.cashTop3} mode="cash" onSelect={onSelect} />
        {showMiles && <ExploreTop3 fares={month.milesTop3} mode="miles" onSelect={onSelect} />}
      </div>)}
    </div>
    <div className="calendar-proof"><CheckCircle2 size={14} /> Top 3 from `MONTH`, then `DAY` for each month · no extrapolated prices</div>
  </section>
}

function LiveSearchState({ elapsed, onCancel }: { elapsed: number; onCancel: () => void }) {
  return (
    <div className="live-search-state" role="status">
      <div className="radar-scope"><Radar size={28} /><span /></div>
      <div><strong>Air France is computing availability</strong><span>Live session · {elapsed.toFixed(1)} s</span></div>
      <button type="button" onClick={onCancel}><X size={15} /> Cancel</button>
    </div>
  )
}

type ResultView = 'deals' | 'all' | 'analysis' | 'months' | 'calendar'
type SortMode = 'deal' | 'cash' | 'miles' | 'duration'
type SearchMode = 'search' | 'explore' | 'scan'

function App() {
  const [request, setRequest] = useState<SearchRequest>(initialRequest)
  const [response, setResponse] = useState<SearchResponse>()
  const [exploreResponse, setExploreResponse] = useState<ExploreResponse>()
  const [searchMode, setSearchMode] = useState<SearchMode>('search')
  const [scanSettings, setScanSettings] = useState<ScanSettings>(initialScanSettings)
  const [scanResponse, setScanResponse] = useState<TripScanResponse>()
  const [explorePaymentMode, setExplorePaymentMode] = useState<'cash' | 'both'>('cash')
  const [flyingBlueReady, setFlyingBlueReady] = useState(false)
  const [awaitingSignIn, setAwaitingSignIn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string>()
  const [sort, setSort] = useState<SortMode>('deal')
  const [view, setView] = useState<ResultView>('deals')
  const [advanced, setAdvanced] = useState(true)
  const [cabinMenu, setCabinMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const [originPending, setOriginPending] = useState(false)
  const [destinationPending, setDestinationPending] = useState(false)
  const searchController = useRef<AbortController | undefined>(undefined)
  const routeReady = !originPending
    && !destinationPending
    && /^[A-Z0-9]{3}$/.test(request.origin.code)
    && /^[A-Z0-9]{3}$/.test(request.destination.code)
    && request.origin.code !== request.destination.code

  const changeSearchMode = (mode: SearchMode) => {
    searchController.current?.abort()
    setLoading(false)
    setError(undefined)
    setSearchMode(mode)
  }

  useEffect(() => {
    if (!loading) return
    const startedAt = performance.now()
    const timer = window.setInterval(() => setElapsed((performance.now() - startedAt) / 1000), 100)
    return () => window.clearInterval(timer)
  }, [loading])

  const ranked = useMemo(() => {
    const offers = rankOffers(response?.offers ?? [], request)
    return [...offers].sort((a, b) => {
      if (sort === 'cash') return (a.selectedPrice.cash ?? Infinity) - (b.selectedPrice.cash ?? Infinity)
      if (sort === 'miles') return (a.selectedPrice.miles ?? Infinity) - (b.selectedPrice.miles ?? Infinity)
      if (sort === 'duration') return a.totalDurationMinutes - b.totalDurationMinutes
      return b.dealScore - a.dealScore
    })
  }, [request, response?.offers, sort])

  const visibleOffers = useMemo(() => view === 'deals' ? ranked.filter((offer) => offer.paretoOptimal) : ranked, [ranked, view])
  const bestCash = useMemo(() => ranked.reduce<RankedOffer | undefined>((best, offer) => (
    offer.selectedPrice.cash != null && (best?.selectedPrice.cash == null || offer.selectedPrice.cash < best.selectedPrice.cash) ? offer : best
  ), undefined), [ranked])
  const bestMiles = useMemo(() => ranked.reduce<RankedOffer | undefined>((best, offer) => (
    offer.selectedPrice.miles != null && (best?.selectedPrice.miles == null || offer.selectedPrice.miles < best.selectedPrice.miles) ? offer : best
  ), undefined), [ranked])
  const fastest = useMemo(() => ranked.reduce<RankedOffer | undefined>((best, offer) => !best || offer.totalDurationMinutes < best.totalDurationMinutes ? offer : best, undefined), [ranked])
  const baseline = bestCash?.selectedPrice.cash

  const patchRequest = <K extends keyof SearchRequest>(key: K, value: SearchRequest[K]) => setRequest((current) => ({ ...current, [key]: value }))
  const toggleCabin = (cabin: Cabin) => setRequest((current) => {
    const cabins = current.cabins.includes(cabin) ? current.cabins.filter((item) => item !== cabin) : [...current.cabins, cabin]
    return { ...current, cabins: cabins.length ? cabins : current.cabins }
  })
  const swapStations = () => {
    setOriginPending(false)
    setDestinationPending(false)
    setRequest((current) => ({ ...current, origin: current.destination, destination: current.origin }))
  }
  const setDepartureDate = (departureDate: string) => setRequest((current) => ({
    ...current,
    departureDate,
    returnDate: current.flexibleDays ? addIsoDays(departureDate, current.tripLengthDays) : current.returnDate,
  }))
  const setFlexibleDays = (flexibleDays: number) => setRequest((current) => ({
    ...current,
    flexibleDays,
    returnDate: flexibleDays ? addIsoDays(current.departureDate, current.tripLengthDays) : current.returnDate,
  }))
  const setTripLength = (tripLengthDays: number) => setRequest((current) => ({
    ...current,
    tripLengthDays,
    returnDate: addIsoDays(current.departureDate, tripLengthDays),
  }))

  const executeSearch = useCallback(async (searchRequest: SearchRequest) => {
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setLoading(true)
    setElapsed(0)
    setError(undefined)
    try {
      const result = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(searchRequest), signal: controller.signal,
      })
      const payload = await result.json() as SearchResponse & { error?: string }
      if (!result.ok) throw new Error(payload.error ?? 'Search failed')
      setResponse(payload)
      setView(payload.offers.length ? 'deals' : 'all')
      if (payload.authRequired || payload.status === 'auth-required') {
        setFlyingBlueReady(false)
        setAwaitingSignIn(true)
        void fetch('/api/auth/open', { method: 'POST' })
      }
    } catch (searchError) {
      if (searchError instanceof DOMException && searchError.name === 'AbortError') return
      setError(searchError instanceof Error ? searchError.message : 'The engine is not responding')
    } finally {
      if (searchController.current === controller) setLoading(false)
    }
  }, [])

  const ensureFlyingBlueSession = useCallback(async (): Promise<boolean> => {
    if (flyingBlueReady) return true
    try {
      const statusResponse = await fetch('/api/auth/status')
      const status = await statusResponse.json() as { authenticated?: boolean }
      if (status.authenticated) {
        setFlyingBlueReady(true)
        setAwaitingSignIn(false)
        return true
      }
    } catch {
      // Fall through to open login.
    }
    setAwaitingSignIn(true)
    try {
      await fetch('/api/auth/open', { method: 'POST' })
    } catch {
      setError('Could not open Chrome for Flying Blue')
    }
    return false
  }, [flyingBlueReady])

  const selectPaymentMode = useCallback((mode: SearchRequest['paymentMode']) => {
    setRequest((current) => ({ ...current, paymentMode: mode }))
    if (mode === 'cash') {
      setAwaitingSignIn(false)
      return
    }
    void ensureFlyingBlueSession()
  }, [ensureFlyingBlueSession])

  const selectExplorePaymentMode = useCallback((mode: 'cash' | 'both') => {
    setExplorePaymentMode(mode)
    if (mode === 'cash') {
      setAwaitingSignIn(false)
      return
    }
    void ensureFlyingBlueSession()
  }, [ensureFlyingBlueSession])

  const runSearch = useCallback(async () => {
    setSearchMode('search')
    if (request.paymentMode !== 'cash') {
      const ready = await ensureFlyingBlueSession()
      if (!ready) return
    }
    void executeSearch(request)
  }, [ensureFlyingBlueSession, executeSearch, request])

  const runExplore = useCallback(async () => {
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setSearchMode('explore')
    if (explorePaymentMode === 'both') {
      const ready = await ensureFlyingBlueSession()
      if (!ready) return
    }
    setLoading(true)
    setElapsed(0)
    setError(undefined)
    setExploreResponse(undefined)
    try {
      const result = await fetch('/api/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: request.origin, destination: request.destination, paymentMode: explorePaymentMode }),
        signal: controller.signal,
      })
      const payload = await result.json() as ExploreResponse & { error?: string }
      if (!result.ok) throw new Error(payload.error ?? 'Explore failed')
      setExploreResponse(payload)
      if (payload.authRequired) {
        setFlyingBlueReady(false)
        setAwaitingSignIn(true)
        void fetch('/api/auth/open', { method: 'POST' })
      }
    } catch (exploreError) {
      if (exploreError instanceof DOMException && exploreError.name === 'AbortError') return
      setError(exploreError instanceof Error ? exploreError.message : 'The engine is not responding')
    } finally {
      if (searchController.current === controller) setLoading(false)
    }
  }, [ensureFlyingBlueSession, explorePaymentMode, request.destination, request.origin])

  const runScan = useCallback(async () => {
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setSearchMode('scan')
    if (!await ensureFlyingBlueSession()) return
    setLoading(true)
    setElapsed(0)
    setError(undefined)
    setScanResponse(undefined)
    try {
      const result = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: request.origin,
          destination: request.destination,
          tripType: request.tripType,
          adults: request.adults,
          cabins: request.cabins.slice(0, 1),
          period: scanSettings.period,
          stayNights: request.tripType === 'return' ? scanSettings.stayNights : null,
          mileValueCents: request.mileValueCents,
        }),
        signal: controller.signal,
      })
      const payload = await result.json() as TripScanResponse
      if (result.status === 401 && payload.authRequired) {
        setFlyingBlueReady(false)
        setAwaitingSignIn(true)
        void fetch('/api/auth/open', { method: 'POST' })
        return
      }
      if (!result.ok) throw new Error(payload.error ?? 'Scan failed')
      setScanResponse(payload)
    } catch (scanError) {
      if (scanError instanceof DOMException && scanError.name === 'AbortError') return
      setError(scanError instanceof Error ? scanError.message : 'The engine is not responding')
    } finally {
      if (searchController.current === controller) setLoading(false)
    }
  }, [ensureFlyingBlueSession, request, scanSettings])

  const selectExploreFare = useCallback((departureDate: string, paymentMode: 'cash' | 'miles') => {
    const nextRequest: SearchRequest = {
      ...request,
      departureDate,
      returnDate: addIsoDays(departureDate, request.tripLengthDays),
      flexibleDays: 1,
      paymentMode,
    }
    setRequest(nextRequest)
    setSearchMode('search')
    void executeSearch(nextRequest)
  }, [executeSearch, request])

  const selectMonthlyDate = useCallback((departureDate: string) => {
    const nextRequest = { ...request, departureDate, returnDate: addIsoDays(departureDate, request.tripLengthDays) }
    setRequest(nextRequest)
    setView('deals')
    void executeSearch(nextRequest)
  }, [executeSearch, request])

  const cancelSearch = () => {
    searchController.current?.abort()
    setLoading(false)
  }

  const copySearch = async () => {
    const text = `${request.origin.code} → ${request.destination.code} · ${readableDate(request.departureDate)}${request.tripType === 'oneway' ? ' · one-way' : ` to ${readableDate(request.returnDate)}`} · ${request.cabins.map((cabin) => cabinLabels[cabin]).join(', ')}`
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const emptyTitle = response?.status === 'blocked'
    ? 'Collection interrupted by Air France'
    : response?.status === 'auth-required'
      ? 'Flying Blue login required'
      : response?.status === 'empty'
        ? 'No offers returned'
        : 'Run a live search'
  const emptyText = response
    ? response.warnings[0] ?? 'Change the dates or constraints, then search again.'
    : 'Pick a route, then query Air France.'
  const exploreEmptyTitle = exploreResponse?.status === 'blocked'
    ? 'Explore interrupted by Air France'
    : exploreResponse?.status === 'auth-required'
      ? 'Flying Blue login required'
      : exploreResponse?.status === 'empty'
        ? 'No calendar returned'
        : 'Explore the next twelve months'
  const exploreEmptyText = exploreResponse
    ? exploreResponse.warnings[0] ?? 'Air France publishes no calendar fares for this route.'
    : 'Enter only the origin and destination to compare the three best days of each month.'
  const activeWarnings = searchMode === 'explore' ? exploreResponse?.warnings : response?.warnings
  const needsFlyingBlueAuth = awaitingSignIn || (searchMode === 'explore'
    ? Boolean(exploreResponse?.authRequired || exploreResponse?.status === 'auth-required')
    : Boolean(response?.authRequired || response?.status === 'auth-required'))
  const onFlyingBlueConfirmed = () => {
    setFlyingBlueReady(true)
    setAwaitingSignIn(false)
    if (searchMode === 'explore') void runExplore()
    else if (searchMode === 'scan') void runScan()
    else void runSearch()
  }
  const nonAuthWarnings = activeWarnings?.filter((warning) => !/Flying Blue|login|log in/i.test(warning))
  const milesGateActive = awaitingSignIn && !flyingBlueReady

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-wing"><Plane size={18} /></span><strong>Ratline</strong><span>live deal desk</span></div>
        <nav aria-label="Main navigation">
          <button className="active" type="button"><Search size={16} /> Search</button>
          <span className="network-contract"><Activity size={15} /> AF network parity</span>
        </nav>
        <div className="top-actions">
          <span className="source-status source-live"><span />Air France only</span>
          <button type="button" className="icon-button" title="Copy search" onClick={copySearch}>{copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="search-panel">
          <div className="context-visual">
            <div><span>Network search</span><strong>{request.origin.code || '—'} <ArrowRight size={18} /> {request.destination.code || '—'}</strong></div>
          </div>

          <div className="search-panel-body">
            <div className="panel-heading"><div><span>New analysis</span><h1>Find the best routing</h1></div><span className="live-pill"><Zap size={13} /> Live</span></div>

            <div className="search-mode-switch" aria-label="Search mode">
              <button type="button" className={searchMode === 'search' ? 'active' : ''} onClick={() => changeSearchMode('search')}><Search size={15} /> Search</button>
              <button type="button" className={searchMode === 'explore' ? 'active' : ''} onClick={() => changeSearchMode('explore')}><CalendarRange size={15} /> Explore</button>
              <button type="button" className={searchMode === 'scan' ? 'active' : ''} onClick={() => changeSearchMode('scan')}><ScanSearch size={15} /> Scan trips</button>
            </div>

            <div className="journey-fields">
              <StationAutocomplete key={`origin-${request.origin.code}`} label="Origin" value={request.origin} onPendingChange={setOriginPending} onChange={(station) => patchRequest('origin', station)} />
              <button className="swap-button" type="button" onClick={swapStations} title="Swap airports"><ArrowDownUp size={16} /></button>
              <StationAutocomplete key={`destination-${request.destination.code || 'empty'}`} label="Destination" value={request.destination} destination onPendingChange={setDestinationPending} onChange={(station) => patchRequest('destination', station)} />
            </div>

            {searchMode === 'scan' && <ScanControls settings={scanSettings} onSettings={setScanSettings} request={request} patchRequest={patchRequest} />}

            {searchMode === 'explore' && <label className="explore-payment-select">
              <span>Fares to compare</span>
              <div><Coins size={16} /><select value={explorePaymentMode} onChange={(event) => selectExplorePaymentMode(event.target.value as 'cash' | 'both')}>
                <option value="cash">Euro prices</option>
                <option value="both">Euros + Miles</option>
              </select><ChevronDown size={15} /></div>
            </label>}

            {searchMode === 'search' && <><div className="mode-section">
              <span>Trip</span>
              <div className="segmented-control">
                {([['return', 'Return'], ['oneway', 'One-way']] as const).map(([tripType, label]) => (
                  <button key={tripType} type="button" className={request.tripType === tripType ? 'active' : ''} onClick={() => patchRequest('tripType', tripType)}>{label}</button>
                ))}
              </div>
            </div>

            <div className="field-row dates-row">
              <label><span>Departure</span><div className="compact-input"><CalendarDays size={16} /><SafeDateInput key={`departure-${request.departureDate}`} value={request.departureDate} min={dateOffset(1)} onCommit={setDepartureDate} /></div></label>
              {request.tripType === 'return' && <label><span>Return date</span><div className="compact-input"><CalendarDays size={16} /><SafeDateInput key={`return-${request.returnDate}`} value={request.returnDate} min={request.departureDate} disabled={request.flexibleDays > 0} onCommit={(value) => patchRequest('returnDate', value)} /></div></label>}
            </div>

            <div className="flex-controls">
              <label className="check-line"><input type="checkbox" checked={request.flexibleDays > 0} onChange={(event) => setFlexibleDays(event.target.checked ? 3 : 0)} /><span><Check size={12} /></span>Flexible dates</label>
              <label><span>Window</span><div className="compact-input"><input type="number" min="1" max="30" disabled={!request.flexibleDays} value={request.flexibleDays || 3} onChange={(event) => setFlexibleDays(Math.min(30, Math.max(1, Number(event.target.value) || 1)))} /><small>± d</small></div></label>
              {request.tripType === 'return' && <label><span>Stay</span><div className="compact-input"><input type="number" min="1" max="30" value={request.tripLengthDays} onChange={(event) => setTripLength(Number(event.target.value))} /><small>d</small></div></label>}
            </div>

            <div className="field-row">
              <label><span>Travellers</span><div className="compact-input"><Users size={16} /><input type="number" min="1" max="9" value={request.adults} onChange={(event) => patchRequest('adults', Number(event.target.value))} /><small>adult</small></div></label>
              <div className="cabin-control">
                <span>Cabins</span>
                <button type="button" onClick={() => setCabinMenu((value) => !value)} aria-expanded={cabinMenu}>{request.cabins.map((cabin) => cabinLabels[cabin]).join(', ')} <ChevronDown size={14} /></button>
                {cabinMenu && <div className="cabin-menu">
                  {(Object.keys(cabinLabels) as Cabin[]).map((cabin) => <label key={cabin}><input type="checkbox" checked={request.cabins.includes(cabin)} onChange={() => toggleCabin(cabin)} /><span><Check size={13} /></span>{cabinLabels[cabin]}</label>)}
                </div>}
              </div>
            </div>

            <div className="mode-section">
              <span>Pay with</span>
              <div className="segmented-control">
                {([['cash', 'Euros'], ['miles', 'Miles'], ['both', 'Compare']] as const).map(([mode, label]) => (
                  <button key={mode} type="button" className={request.paymentMode === mode ? 'active' : ''} onClick={() => selectPaymentMode(mode)}>{mode === 'miles' && <Coins size={14} />}{label}</button>
                ))}
              </div>
              {request.paymentMode !== 'cash' && <label className="mile-value"><span>Mile value</span><input type="range" min="0.5" max="3" step="0.1" value={request.mileValueCents} onChange={(event) => patchRequest('mileValueCents', Number(event.target.value))} /><strong>{request.mileValueCents.toFixed(1)} c</strong></label>}
              {milesGateActive && searchMode === 'search' && request.paymentMode !== 'cash' && (
                <p className="miles-auth-hint">Chrome is waiting for your Flying Blue login. Confirm with "I'm logged in".</p>
              )}
            </div>

            <button className="advanced-toggle" type="button" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}><SlidersHorizontal size={16} /> Trip constraints <ChevronDown size={15} /></button>
            {advanced && <div className="advanced-fields">
              <label><span>Max stops</span><div className="stepper">{([0, 1, 2] as const).map((value) => <button type="button" className={request.maxStops === value ? 'active' : ''} key={value} onClick={() => patchRequest('maxStops', value)}>{value}</button>)}</div></label>
              <label><span>Max duration</span><div className="compact-input"><Clock3 size={15} /><input type="number" min="8" max="72" value={request.maxDurationHours} onChange={(event) => patchRequest('maxDurationHours', Number(event.target.value))} /><small>h</small></div></label>
              <label className="check-line"><input type="checkbox" checked={request.nearbyAirports} onChange={(event) => patchRequest('nearbyAirports', event.target.checked)} /><span><Check size={12} /></span>Nearby airports</label>
              <label className="check-line"><input type="checkbox" checked={request.longLayover} onChange={(event) => patchRequest('longLayover', event.target.checked)} /><span><Check size={12} /></span>Long layovers</label>
              <label className="check-line"><input type="checkbox" checked={request.separateTickets} onChange={(event) => patchRequest('separateTickets', event.target.checked)} /><span><Check size={12} /></span>Separate tickets</label>
            </div>}</>}

            <button className={`search-button ${searchMode === 'explore' ? 'explore' : ''}`} type="button" onClick={() => { void (searchMode === 'explore' ? runExplore() : searchMode === 'scan' ? runScan() : runSearch()) }} disabled={loading || !routeReady || milesGateActive}>
              {loading
                ? <><RefreshCw className="spin" size={17} /> {searchMode === 'search' ? 'Querying Air France…' : 'Reading calendars…'}</>
                : milesGateActive
                  ? <><Coins size={17} /> Waiting for Miles login…</>
                  : searchMode === 'scan'
                    ? <><ScanSearch size={17} /> Scan for the best trips</>
                  : searchMode === 'explore'
                    ? <><CalendarRange size={17} /> Find monthly Top 3</>
                    : <><Search size={17} /> Run live analysis</>}
            </button>
            <p className={`search-footnote ${!routeReady || milesGateActive ? 'is-warning' : ''}`}><Database size={13} /> {!routeReady ? 'Pick an Air France origin and destination' : milesGateActive ? 'Log in in Chrome, then click "I\'m logged in"' : searchMode === 'scan' ? 'Air France DAY calendars, both directions' : searchMode === 'explore' ? 'Air France MONTH + DAY calendars' : 'Live Air France fares'}</p>
          </div>
        </aside>

        <section className="results-panel">
          <div className="results-header">
            <div>
              <span className="eyebrow">{request.origin.cityName || 'Origin'} to {request.destination.cityName || 'destination'}</span>
              <h2>{searchMode === 'scan'
                ? scanResponse ? `${scanResponse.byMiles.length} best trips` : 'Miles trip scanner'
                : searchMode === 'explore'
                ? exploreResponse ? `${exploreResponse.months.length} months compared` : 'Yearly euros + Miles radar'
                : response ? `${ranked.length} Air France itineraries` : 'Live comparison cockpit'}</h2>
              <p>{searchMode === 'scan'
                ? `Flying Blue · ${request.tripType === 'oneway' ? 'one-way' : 'return'} · ${request.adults} adult${request.adults > 1 ? 's' : ''} · ${cabinLabels[request.cabins[0]]}`
                : searchMode === 'explore'
                ? `Top 3 return prices per month · ${explorePaymentMode === 'both' ? 'Euros + Miles' : 'Euros'} · Economy · 1 adult`
                : <>{readableDate(request.departureDate)}{request.tripType === 'oneway' ? ' · one-way' : ` · ${readableDate(request.returnDate)}`}{request.flexibleDays ? ` · ±${request.flexibleDays} d${request.tripType === 'oneway' ? '' : ` · stay ${request.tripLengthDays} d`}` : ''} · {request.adults} traveller{request.adults > 1 ? 's' : ''} · {request.cabins.map((cabin) => cabinLabels[cabin]).join(', ')}</>}</p>
            </div>
            <div className="header-actions">
              <button type="button" className="icon-button" title="Refresh" onClick={searchMode === 'explore' ? runExplore : searchMode === 'scan' ? runScan : runSearch} disabled={loading || !routeReady}><RefreshCw size={17} /></button>
            </div>
          </div>

          {loading && <LiveSearchState elapsed={elapsed} onCancel={cancelSearch} />}
          <AuthPrompt visible={!loading && needsFlyingBlueAuth} onConfirmed={onFlyingBlueConfirmed} />
          {(error || nonAuthWarnings?.length) ? <div className={`status-banner ${error || (searchMode === 'explore' ? exploreResponse?.status : response?.status) === 'blocked' ? 'is-error' : ''}`}><CircleAlert size={17} /><span>{error ?? nonAuthWarnings?.[0]}</span>{error && <button type="button" title="Close" onClick={() => setError(undefined)}><X size={15} /></button>}</div> : null}

          {searchMode === 'scan' && scanResponse && <ScanResults response={scanResponse} request={request} />}

          {searchMode === 'explore' && exploreResponse && exploreResponse.months.length > 0 && <ExploreCalendar response={exploreResponse} paymentMode={explorePaymentMode} onSelect={selectExploreFare} />}

          {searchMode === 'search' && ranked.length > 0 && <>
            <section className="decision-band" aria-label="Best options">
              <div className="decision-intro"><span>Quick decision</span><strong>At a glance</strong></div>
              <div className="decision-item"><span className="decision-icon cash"><TicketCheck size={17} /></span><div><small>Best cash</small><strong>{formatCash(bestCash?.selectedPrice.cash)}</strong><span>{bestCash?.route.join(' · ')}</span></div></div>
              <div className="decision-item"><span className="decision-icon miles"><Coins size={17} /></span><div><small>Fewest Miles</small><strong>{formatMiles(bestMiles?.selectedPrice.miles)}</strong><span>{bestMiles ? `+ ${formatCash(bestMiles.selectedPrice.taxes)}` : 'Session required'}</span></div></div>
              <div className="decision-item"><span className="decision-icon time"><Gauge size={17} /></span><div><small>Fastest</small><strong>{fastest ? formatDuration(fastest.totalDurationMinutes) : '—'}</strong><span>{fastest?.stops === 0 ? 'Non-stop' : `${fastest?.stops} stop${(fastest?.stops ?? 0) > 1 ? 's' : ''}`}</span></div></div>
            </section>

            <div className="result-toolbar">
              <div className="view-tabs">
                <button type="button" className={view === 'deals' ? 'active' : ''} onClick={() => setView('deals')}>Frontier <span>{ranked.filter((offer) => offer.paretoOptimal).length}</span></button>
                <button type="button" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All <span>{ranked.length}</span></button>
                <button type="button" className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}><BarChart3 size={13} /> Analysis</button>
                <button type="button" className={view === 'months' ? 'active' : ''} onClick={() => setView('months')}><CalendarRange size={13} /> Price by month <span>{response?.monthlyCalendar.length ?? 0}</span></button>
                <button type="button" className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}><CalendarDays size={13} /> Exact dates</button>
              </div>
              {(view === 'deals' || view === 'all') && <div className="sort-control"><span>Sort</span>{([['deal', 'Score'], ['cash', 'Price'], ['miles', 'Miles'], ['duration', 'Duration']] as const).map(([value, label]) => <button type="button" key={value} className={sort === value ? 'active' : ''} onClick={() => setSort(value)}>{label}</button>)}</div>}
            </div>

            {view === 'analysis' ? <div className="analysis-grid">
              <FrontierChart offers={ranked} />
              <aside className="trace-panel">
                <div><Activity size={16} /><span>Data chain</span></div>
                <ol>
                  <li><strong>Reference data</strong><span>Air France GraphQL</span></li>
                  <li><strong>Availability</strong><span>Air France Search</span></li>
                  <li><strong>Ranking</strong><span>Local Pareto</span></li>
                </ol>
                <div className="trace-proof"><CheckCircle2 size={16} /><span><strong>{response?.trace.cacheHit ? 'Recent live capture' : 'Fresh live capture'}</strong><small>{response ? dateTimeLabel(response.searchedAt) : ''}</small></span></div>
                <div className="trace-operations">{response?.trace.operations.slice(-4).map((operation) => <span key={operation}>{operation}</span>)}</div>
              </aside>
            </div> : view === 'months' ? <MonthlyCalendar items={response?.monthlyCalendar ?? []} request={request} onSelect={selectMonthlyDate} /> : view === 'calendar' ? <FareCalendar items={response?.fareCalendar ?? []} request={request} /> : <>
              <div className="offer-table-head"><span>Airline</span><span>Route</span><span>Duration</span><span>Fare</span><span>Deal</span></div>
              <div className={`offers-list ${loading ? 'is-loading' : ''}`}>
                {visibleOffers.map((offer) => <OfferRow key={offer.id} offer={offer} baseline={baseline} />)}
              </div>
            </>}
          </>}

          {searchMode === 'search' && !loading && ranked.length === 0 && !needsFlyingBlueAuth && <div className={`empty-results ${response ? `empty-${response.status}` : ''}`}>
            {response?.status === 'blocked' ? <TimerReset size={30} /> : <Route size={30} />}
            <strong>{emptyTitle}</strong>
            <span>{emptyText}</span>
            {!response && <button type="button" onClick={runSearch} disabled={!routeReady}><Search size={15} /> Query Air France</button>}
          </div>}

          {searchMode === 'explore' && !loading && (!exploreResponse || exploreResponse.months.length === 0) && !needsFlyingBlueAuth && <div className={`empty-results ${exploreResponse ? `empty-${exploreResponse.status}` : ''}`}>
            {exploreResponse?.status === 'blocked' ? <TimerReset size={30} /> : <CalendarRange size={30} />}
            <strong>{exploreEmptyTitle}</strong>
            <span>{exploreEmptyText}</span>
            {!exploreResponse && <button type="button" onClick={runExplore} disabled={!routeReady}><CalendarRange size={15} /> Explore months</button>}
          </div>}

          <footer className="results-footer">
            {searchMode === 'explore' ? <>
              <span><Info size={14} /> {exploreResponse ? `Last explore ${dateTimeLabel(exploreResponse.searchedAt)}` : 'Waiting for Air France calendars'}</span>
              <span>{exploreResponse ? `${(exploreResponse.durationMs / 1000).toFixed(1)} s · ${exploreResponse.months.length} months · ${exploreResponse.trace.cacheHit ? 'live cache 90 s' : 'fresh session'}` : 'source: none'}</span>
            </> : <>
              <span><Info size={14} /> {response ? `Last request ${dateTimeLabel(response.searchedAt)}` : 'Waiting for an Air France request'}</span>
              <span>{response ? `${(response.durationMs / 1000).toFixed(1)} s · ${response.trace.candidatePairs} exact pair${response.trace.candidatePairs > 1 ? 's' : ''} · ${response.trace.cacheHit ? 'live cache 90 s' : 'fresh session'}` : 'source: none'}</span>
            </>}
          </footer>
        </section>
      </main>
    </div>
  )
}

export default App
