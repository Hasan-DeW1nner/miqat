import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS, type PrayerKey, type Settings } from './prayer';
import { methodForPlace } from './methods';
import type { Place } from './geo';
import type { QuranBookmark, ReciterId } from './quran';
import { readPreferenceCookie } from './preferenceCookie';
import type { OfflinePage } from './offline';

export const BUILTIN_DHIKR = ['istighfar', 'tasbih', 'tahmid', 'takbir'] as const;
export type BuiltinDhikr = (typeof BUILTIN_DHIKR)[number];

/**
 * Open on purpose: a counter may be one of the four built-ins or a phrase the
 * user typed, which carries an id of its own. History is keyed by these strings
 * either way, so opening the type keeps every day already counted.
 */
export type DhikrKind = string;
export type DhikrCounts = Record<string, number>;

/** A phrase the user added themselves. Arabic is the only required part. */
export interface CustomDhikr {
  id: string;
  arabic: string;
  transliteration?: string;
  meaning?: string;
}

const EMPTY_DHIKR: DhikrCounts = {};

interface State {
  place: Place | null;
  settings: Settings;
  /** Set once the user picks a method by hand, so auto-detect stops overriding. */
  methodPinned: boolean;
  /** Whether the board shows the adhan or the congregation (iqama) times. */
  viewMode: 'adhan' | 'iqama';
  setViewMode: (mode: 'adhan' | 'iqama') => void;
  /**
   * Opt-in to sending exact coordinates to the app's owner. Off unless the user
   * turns it on — a pre-ticked box is not consent.
   */
  sharePreciseLocation: boolean;
  setSharePreciseLocation: (share: boolean) => void;
  /** Degrees added to the raw compass to reach true north, set from the sun. */
  qiblaOffset: number;
  setQiblaOffset: (offset: number) => void;
  setPlace: (place: Place) => void;
  patchSettings: (patch: Partial<Settings>) => void;
  setOffset: (key: PrayerKey, minutes: number) => void;
  pinMethod: (pinned: boolean) => void;
  setIqamaOffset: (key: PrayerKey, minutes: number | null) => void;
  resetOffsets: () => void;
  /** Daily, on-device totals. No account or network is involved. */
  dhikrHistory: Record<string, DhikrCounts>;
  recordDhikr: (day: string, kind: DhikrKind, amount: number) => void;
  resetDhikr: (day: string, kind: DhikrKind) => void;
  /** Phrases the user added. Stored on the device with everything else. */
  customDhikr: CustomDhikr[];
  addCustomDhikr: (entry: Omit<CustomDhikr, 'id'>) => string;
  updateCustomDhikr: (id: string, patch: Partial<Omit<CustomDhikr, 'id'>>) => void;
  removeCustomDhikr: (id: string) => void;
  /**
   * Pages the reader chose to keep on the device. The service worker holds the
   * files; this is the intent, so a new build can fetch them again.
   */
  offlinePages: OfflinePage[];
  setOfflinePage: (page: OfflinePage, keep: boolean) => void;
  /** Checked morning/evening rituals, grouped by local calendar day. */
  ritualChecks: Record<string, string[]>;
  toggleRitual: (day: string, ritualId: string) => void;
  quranBookmark: QuranBookmark | null;
  setQuranBookmark: (mark: QuranBookmark) => void;
  quranShowEnglish: boolean;
  setQuranShowEnglish: (show: boolean) => void;
  quranReciter: ReciterId;
  setQuranReciter: (id: ReciterId) => void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      place: null,
      settings: DEFAULT_SETTINGS,
      methodPinned: false,
      viewMode: 'adhan',
      setViewMode: (viewMode) => set({ viewMode }),
      sharePreciseLocation: false,
      setSharePreciseLocation: (sharePreciseLocation) => set({ sharePreciseLocation }),
      qiblaOffset: 0,
      setQiblaOffset: (qiblaOffset) => set({ qiblaOffset }),
      setPlace: (place) => {
        const { methodPinned, settings } = get();
        set({
          place,
          settings: {
            ...settings,
            elevation: place.elevation,
            method: methodPinned
              ? settings.method
              : methodForPlace(place.countryCode, place.latitude, place.longitude),
          },
        });
      },
      patchSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
      setOffset: (key, minutes) =>
        set({
          settings: {
            ...get().settings,
            offsets: { ...get().settings.offsets, [key]: minutes },
          },
        }),
      pinMethod: (methodPinned) => set({ methodPinned }),
      setIqamaOffset: (key, minutes) =>
        set({
          settings: {
            ...get().settings,
            iqamaOffsets: { ...get().settings.iqamaOffsets, [key]: minutes },
          },
        }),
      resetOffsets: () =>
        set({
          settings: {
            ...get().settings,
            offsets: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
          },
        }),
      dhikrHistory: {},
      recordDhikr: (day, kind, amount) => {
        if (!Number.isFinite(amount) || amount <= 0) return;
        set((state) => {
          const existing = state.dhikrHistory[day] ?? EMPTY_DHIKR;
          return {
            dhikrHistory: {
              ...state.dhikrHistory,
              [day]: { ...existing, [kind]: (existing[kind] ?? 0) + Math.floor(amount) },
            },
          };
        });
      },
      resetDhikr: (day, kind) =>
        set((state) => {
          const existing = state.dhikrHistory[day];
          if (!existing) return state;
          return {
            dhikrHistory: {
              ...state.dhikrHistory,
              [day]: { ...existing, [kind]: 0 },
            },
          };
        }),
      customDhikr: [],
      addCustomDhikr: (entry) => {
        const id = `custom:${crypto.randomUUID()}`;
        set((state) => ({ customDhikr: [...state.customDhikr, { ...entry, id }] }));
        return id;
      },
      updateCustomDhikr: (id, patch) =>
        set((state) => ({
          customDhikr: state.customDhikr.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      removeCustomDhikr: (id) =>
        set((state) => ({ customDhikr: state.customDhikr.filter((item) => item.id !== id) })),
      offlinePages: [],
      setOfflinePage: (page, keep) =>
        set((state) => ({
          offlinePages: keep
            ? state.offlinePages.includes(page) ? state.offlinePages : [...state.offlinePages, page]
            : state.offlinePages.filter((id) => id !== page),
        })),
      ritualChecks: {},
      toggleRitual: (day, ritualId) =>
        set((state) => {
          const current = state.ritualChecks[day] ?? [];
          const checked = current.includes(ritualId);
          return {
            ritualChecks: {
              ...state.ritualChecks,
              [day]: checked
                ? current.filter((id) => id !== ritualId)
                : [...current, ritualId],
            },
          };
        }),
      quranBookmark: null,
      setQuranBookmark: (quranBookmark) => set({ quranBookmark }),
      quranShowEnglish: false,
      setQuranShowEnglish: (quranShowEnglish) => set({ quranShowEnglish }),
      quranReciter: 'ar.alafasy',
      setQuranReciter: (quranReciter) => set({ quranReciter }),
    }),
    {
      name: 'miqat.v1',
      version: 1,
      merge: (persisted, current) => {
        const saved = persisted as Partial<State> | undefined;
        const cookie = saved ? undefined : readPreferenceCookie();
        const settings = {
          ...DEFAULT_SETTINGS,
          ...(cookie?.settings ?? {}),
          ...(saved?.settings ?? {}),
        };
        // Re-derive the convention on every load unless the user chose one, so a
        // stored location can never end up paired with a stale global default.
        if (!saved?.methodPinned && saved?.place) {
          settings.method = methodForPlace(
            saved.place.countryCode,
            saved.place.latitude,
            saved.place.longitude,
          );
        }
        return {
          ...current,
          ...(cookie ?? {}),
          ...saved,
          settings,
          // Older saved state predates custom phrases and offline downloads.
          customDhikr: saved?.customDhikr ?? [],
          offlinePages: saved?.offlinePages ?? [],
        };
      },
    },
  ),
);
