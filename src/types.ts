export type Cabin = 'ECONOMY' | 'PREMIUM' | 'BUSINESS'
export type PaymentMode = 'cash' | 'miles' | 'both'
export type TripType = 'return' | 'oneway'
export type DataSource = 'live'
export type SearchStatus = 'complete' | 'empty' | 'blocked' | 'auth-required'

export interface Station {
  code: string
  cityCode: string
  cityName: string
  countryName: string
  displayText: string
  stationType: 'AIRPORT' | 'CITY' | 'RAIL' | string
  isOrigin: boolean
  isDestination: boolean
}

export interface SearchRequest {
  origin: Station
  destination: Station
  tripType: TripType
  departureDate: string
  /** Ignored when tripType is 'oneway'. */
  returnDate: string
  flexibleDays: number
  tripLengthDays: number
  cabins: Cabin[]
  paymentMode: PaymentMode
  adults: number
  maxStops: 0 | 1 | 2
  maxDurationHours: number
  nearbyAirports: boolean
  separateTickets: boolean
  longLayover: boolean
  mileValueCents: number
}

export interface Segment {
  from: string
  to: string
  departure: string
  arrival: string
  durationMinutes?: number
  carrier: string
  flightNumber?: string
  operatingCarrier?: string
  operatingFlightNumber?: string
  aircraft?: string
  originName?: string
  destinationName?: string
  layoverAfterMinutes?: number
  seatMapEligible?: boolean
}

export interface CabinPrice {
  cabin: Cabin
  cash?: number
  miles?: number
  taxes?: number
  seatsAvailable?: number
  fareFamily?: string
}

export interface RawOffer {
  id: string
  segments: Segment[]
  prices: CabinPrice[]
  source: DataSource
  verifiedAt: string
  singleTicket: boolean
  bagsIncluded: boolean | null
  totalDurationMinutes?: number
  fareLabel?: string
  departureDate?: string
  returnDate?: string
}

export interface FareCalendarItem {
  departureDate: string
  returnDate?: string
  label: string
  cash?: number
  miles?: number
  taxes?: number
  selected: boolean
}

export interface MonthlyFareItem {
  month: string
  label: string
  cash?: number
  cashFlightDate?: string
  miles?: number
  milesFlightDate?: string
  taxes?: number
  itineraryCash?: number
  itineraryMiles?: number
}

export interface ExploreFare {
  date: string
  price: number
  taxes?: number
}

export interface ExploreMonthItem {
  month: string
  label: string
  cashTop3: ExploreFare[]
  milesTop3: ExploreFare[]
}

export interface ExploreResponse {
  requestId: string
  source: DataSource
  months: ExploreMonthItem[]
  warnings: string[]
  searchedAt: string
  durationMs: number
  status: SearchStatus
  /** True when Miles were requested but Flying Blue session is missing. */
  authRequired?: boolean
  trace: {
    operations: string[]
    cacheHit: boolean
  }
}

export interface RankedOffer extends RawOffer {
  selectedPrice: CabinPrice
  totalDurationMinutes: number
  stops: number
  route: string[]
  generalizedCost: number
  dealScore: number
  mileValueCents?: number
  savings: number
  risk: 'low' | 'medium' | 'high'
  paretoOptimal: boolean
  badges: string[]
}

export interface SearchResponse {
  requestId: string
  source: DataSource
  offers: RawOffer[]
  warnings: string[]
  searchedAt: string
  durationMs: number
  status: SearchStatus
  fareCalendar: FareCalendarItem[]
  monthlyCalendar: MonthlyFareItem[]
  /** True when Miles were requested but Flying Blue session is missing. */
  authRequired?: boolean
  trace: {
    catalog: 'airfrance-gql'
    collector: 'airfrance-gql'
    cacheHit: boolean
    operations: string[]
    candidatePairs: number
  }
}

export type ScanPeriod = 'month' | 'quarter' | 'year' | '12m'

export interface DayFare {
  date: string
  /** Miles (Flying Blue) or euros (cash) for all passengers. */
  price: number
  /** Euro taxes on an award; cash prices already include them. */
  taxes?: number
}

export interface TripOption {
  outboundDate: string
  returnDate?: string
  nights?: number
  outboundPrice: number
  returnPrice?: number
  totalPrice: number
  totalTaxes: number
  /** Miles at the chosen mile value plus taxes, in euros. */
  valueEur: number
}

export interface TripScanRequest {
  origin: Station
  destination: Station
  tripType: TripType
  /** Flying Blue miles or euro fares. */
  paymentMode: 'miles' | 'cash'
  adults: number
  cabins: Cabin[]
  period: ScanPeriod
  /** null = any stay length (1 to 60 nights). */
  stayNights: number | null
  mileValueCents: number
}

export interface ScanProgress {
  running: boolean
  /** Air France calendar calls finished / planned. */
  done: number
  total: number
  /** What is being fetched now, e.g. "Outbound Nov 2026". */
  label: string
  startedAt?: string
}

export interface TripScanResponse {
  currency: 'MILES' | 'EUR'
  from: string
  to: string
  outbound: DayFare[]
  inbound?: DayFare[]
  byPrice: TripOption[]
  byValue: TripOption[]
  /** Cheapest outbound days, each with its cheapest returns. */
  byOutbound: Array<{ outbound: DayFare; returns: TripOption[] }>
  requests: number
  durationMs: number
  authRequired?: boolean
  error?: string
}
