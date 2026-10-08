import { ChevronLeft, ChevronRight, Plane, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { monthGrid, monthsBetween, priceTier } from './lib/calendar'
import type { DayFare, RawOffer, SearchRequest, SearchResponse, TripScanResponse } from './types'

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthTitle = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const number = new Intl.NumberFormat('en-GB')
const euros = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

const nightsBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** "60k" / "€1,402": short enough for a day square. */
const compact = (price: number, miles: boolean) => (
  miles ? `${price >= 1000 ? `${Math.round(price / 100) / 10}k` : price}` : euros.format(price)
)

interface MonthCalendarProps {
  title: string
  months: string[]
  month: string
  onMonth: (month: string) => void
  priceFor: (date: string) => { price: number; taxes?: number } | undefined
  selected?: string
  anchor?: string
  onSelect: (date: string) => void
  miles: boolean
}

function MonthCalendar({ title, months, month, onMonth, priceFor, selected, anchor, onSelect, miles }: MonthCalendarProps) {
  const index = months.indexOf(month)
  const weeks = monthGrid(month)
  const visible = weeks.flat().flatMap((date) => (date && priceFor(date) ? [priceFor(date)!.price] : []))
  return <section className="scan-cal">
    <header>
      <button type="button" aria-label="Previous month" disabled={index <= 0} onClick={() => onMonth(months[index - 1])}><ChevronLeft size={16} /></button>
      <div><span>{title}</span><strong>{monthTitle.format(new Date(`${month}-01T00:00:00Z`))}</strong></div>
      <button type="button" aria-label="Next month" disabled={index >= months.length - 1} onClick={() => onMonth(months[index + 1])}><ChevronRight size={16} /></button>
    </header>
    <div className="scan-cal-grid">
      {weekdays.map((day) => <span className="scan-cal-weekday" key={day}>{day}</span>)}
      {weeks.flat().map((date, cell) => {
        if (!date) return <span className="scan-cal-blank" key={`blank-${cell}`} />
        const fare = priceFor(date)
        const isAnchor = date === anchor
        return <button
          type="button"
          key={date}
          disabled={!fare}
          className={`scan-cal-day ${fare ? `tier-${priceTier(fare.price, visible)}` : 'is-empty'} ${date === selected ? 'is-selected' : ''} ${isAnchor ? 'is-anchor' : ''}`}
          onClick={() => onSelect(date)}
          title={fare ? `${longDay.format(new Date(`${date}T00:00:00Z`))}: ${miles ? `${number.format(fare.price)} miles` : euros.format(fare.price)}${fare.taxes != null ? ` + ${euros.format(fare.taxes)}` : ''}` : 'No seats'}
        >
          <span className="scan-cal-date">{Number(date.slice(8))}</span>
          {fare && <strong>{compact(fare.price, miles)}</strong>}
          {fare?.taxes != null && <small>+{euros.format(fare.taxes)}</small>}
        </button>
      })}
    </div>
  </section>
}

const timeOf = (iso?: string) => (iso && iso.length >= 16 ? iso.slice(11, 16) : '—')
const plusDays = (from?: string, to?: string) => {
  if (!from || !to) return ''
  const days = nightsBetween(from.slice(0, 10), to.slice(0, 10))
  return days > 0 ? ` +${days}` : ''
}
const duration = (minutes?: number) => (minutes ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}` : '')

function FlightList({ title, offers, loading, error, request, miles }: {
  title: string
  offers?: RawOffer[]
  loading: boolean
  error?: string
  request: SearchRequest
  miles: boolean
}) {
  const cabin = request.cabins[0]
  const rows = (offers ?? []).flatMap((offer) => {
    const price = offer.prices.find((item) => item.cabin === cabin)
    const value = miles ? price?.miles : price?.cash
    return value == null ? [] : [{ offer, value, taxes: price?.taxes }]
  }).sort((left, right) => left.value - right.value).slice(0, 6)
  return <div className="scan-flights">
    <h4><Plane size={14} /> {title}</h4>
    {loading ? <p className="scan-flights-note"><RefreshCw className="spin" size={13} /> Asking Air France for the flights…</p>
      : error ? <p className="scan-flights-note is-error">{error}</p>
      : !rows.length ? <p className="scan-flights-note">No {cabin.toLowerCase()} seats left on this day.</p>
      : <ul>{rows.map(({ offer, value, taxes }) => {
        const first = offer.segments[0]
        const last = offer.segments.at(-1)!
        const stops = offer.segments.length - 1
        return <li key={offer.id}>
          <span className="times"><strong>{timeOf(first.departure)}</strong> {first.from} → <strong>{timeOf(last.arrival)}{plusDays(first.departure, last.arrival)}</strong> {last.to}</span>
          <span className="flights">{offer.segments.map((segment) => segment.flightNumber).filter(Boolean).join(' · ')}</span>
          <span className="meta">{stops ? `${stops} stop${stops > 1 ? 's' : ''} via ${offer.segments.slice(0, -1).map((segment) => segment.to).join(', ')}` : 'Direct'} · {duration(offer.totalDurationMinutes)}</span>
          <span className="price">{miles ? `${number.format(value)} miles` : euros.format(value)}{taxes != null && miles ? <small> + {euros.format(taxes)}</small> : null}</span>
        </li>
      })}</ul>}
  </div>
}

/** One exact one-way search per leg so both legs show real flight times. */
const useLegOffers = (request: SearchRequest, origin: SearchRequest['origin'], destination: SearchRequest['destination'], date: string | undefined, miles: boolean) => {
  const [state, setState] = useState<{ key?: string; offers?: RawOffer[]; error?: string }>({})
  const key = date ? `${origin.code}-${destination.code}-${date}-${miles}-${request.adults}-${request.cabins[0]}` : undefined
  useEffect(() => {
    if (!date || !key) return
    const controller = new AbortController()
    const body: SearchRequest = {
      ...request, origin, destination, tripType: 'oneway', departureDate: date, returnDate: date,
      flexibleDays: 0, paymentMode: miles ? 'miles' : 'cash', cabins: request.cabins.slice(0, 1),
    }
    fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
      .then(async (result) => {
        const payload = await result.json() as SearchResponse & { error?: string }
        if (!result.ok) throw new Error(payload.error ?? 'Air France did not answer')
        setState({ key, offers: payload.offers, error: payload.status === 'auth-required' ? 'Log in to Flying Blue to see these flights.' : undefined })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({ key, error: error instanceof Error ? error.message : 'Air France did not answer' })
      })
    return () => controller.abort()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- key captures every input
  const current = state.key === key
  return { offers: current ? state.offers : undefined, error: current ? state.error : undefined, loading: Boolean(key) && !current }
}

export function ScanCalendar({ response, request, stayNights }: { response: TripScanResponse; request: SearchRequest; stayNights: number | null }) {
  const miles = response.currency === 'MILES'
  const outByDate = useMemo(() => new Map(response.outbound.map((day) => [day.date, day])), [response])
  const backByDate = useMemo(() => new Map((response.inbound ?? []).map((day) => [day.date, day])), [response])
  const outMonths = monthsBetween(response.from, response.to)
  const backMonths = response.inbound?.length
    ? monthsBetween(response.inbound[0].date, response.inbound.at(-1)!.date)
    : outMonths
  const cheapestOut = [...response.outbound].sort((left, right) => left.price - right.price)[0]
  const [outMonth, setOutMonth] = useState(cheapestOut?.date.slice(0, 7) ?? outMonths[0])
  const [backMonth, setBackMonth] = useState(cheapestOut?.date.slice(0, 7) ?? backMonths[0])
  const [outDate, setOutDate] = useState<string>()
  const [backDate, setBackDate] = useState<string>()

  const returnAllowed = (date: string) => Boolean(outDate && date > outDate
    && (stayNights == null ? nightsBetween(outDate, date) <= 60 : nightsBetween(outDate, date) === stayNights))
  // After an outbound pick, return squares show the trip total; before, the return leg alone.
  const backPriceFor = (date: string): DayFare | undefined => {
    const back = backByDate.get(date)
    if (!back) return undefined
    if (!outDate) return back
    if (!returnAllowed(date)) return undefined
    const out = outByDate.get(outDate)!
    return { date, price: out.price + back.price, ...(out.taxes != null || back.taxes != null ? { taxes: (out.taxes ?? 0) + (back.taxes ?? 0) } : {}) }
  }

  const pickOut = (date: string) => {
    setOutDate(date)
    setBackDate(undefined)
    // Jump the return calendar to the first bookable return after this outbound.
    const firstReturn = [...backByDate.keys()].sort().find((day) => day > date)
    if (firstReturn) setBackMonth(firstReturn.slice(0, 7))
  }

  const out = outDate ? outByDate.get(outDate) : undefined
  const back = backDate ? backByDate.get(backDate) : undefined
  const outLeg = useLegOffers(request, request.origin, request.destination, outDate, miles)
  const backLeg = useLegOffers(request, request.destination, request.origin, backDate, miles)
  const total = out ? out.price + (back?.price ?? 0) : undefined
  const taxes = out ? (out.taxes ?? 0) + (back?.taxes ?? 0) : undefined
  const value = total != null ? (miles ? total * request.mileValueCents / 100 + (taxes ?? 0) : total) : undefined
  const oneWay = !response.inbound

  return <div className="scan-calendars">
    <div className={`scan-cal-pair ${oneWay ? 'is-single' : ''}`}>
      <MonthCalendar title="Outbound" months={outMonths} month={outMonth} onMonth={setOutMonth} miles={miles}
        priceFor={(date) => outByDate.get(date)} selected={outDate} onSelect={pickOut} />
      {!oneWay && <MonthCalendar title={outDate ? 'Return · trip total' : 'Return'} months={backMonths} month={backMonth} onMonth={setBackMonth} miles={miles}
        priceFor={backPriceFor} selected={backDate} anchor={outDate} onSelect={setBackDate} />}
    </div>

    <section className="scan-trip">
      {!out ? <p className="scan-trip-hint">Pick an outbound day{oneWay ? '' : ', then a return day'} to see the flights and the full price.</p> : <>
        <div className="scan-trip-sum">
          <div><span>Outbound</span><strong>{longDay.format(new Date(`${out.date}T00:00:00Z`))}</strong><small>{miles ? `${number.format(out.price)} miles` : euros.format(out.price)}{out.taxes != null ? ` + ${euros.format(out.taxes)}` : ''}</small></div>
          {!oneWay && <div><span>Return</span><strong>{back ? longDay.format(new Date(`${back.date}T00:00:00Z`)) : 'Pick a day'}</strong><small>{back ? `${miles ? `${number.format(back.price)} miles` : euros.format(back.price)}${back.taxes != null ? ` + ${euros.format(back.taxes)}` : ''}` : ''}</small></div>}
          {!oneWay && back && <div><span>Stay</span><strong>{nightsBetween(out.date, back.date)} nights</strong></div>}
          <div className="is-total"><span>{miles ? 'Total miles' : 'Total fare'}</span><strong>{miles ? number.format(total!) : euros.format(total!)}</strong><small>{miles ? `+ ${euros.format(taxes ?? 0)} taxes` : 'taxes included'}</small></div>
          {miles && <div><span>Value at {request.mileValueCents} ct</span><strong>{euros.format(value!)}</strong></div>}
        </div>
        <p className="scan-trip-note">{request.adults} adult{request.adults > 1 ? 's' : ''} · {request.cabins[0].toLowerCase()} · lowest prices from Air France's day calendars{miles ? '' : '; a return ticket can price differently from two one-ways'}.</p>
        <div className={`scan-flight-pair ${oneWay || !back ? 'is-single' : ''}`}>
          <FlightList title={`${request.origin.code} → ${request.destination.code} · ${longDay.format(new Date(`${out.date}T00:00:00Z`))}`} {...outLeg} request={request} miles={miles} />
          {back && <FlightList title={`${request.destination.code} → ${request.origin.code} · ${longDay.format(new Date(`${back.date}T00:00:00Z`))}`} {...backLeg} request={request} miles={miles} />}
        </div>
      </>}
    </section>
  </div>
}
