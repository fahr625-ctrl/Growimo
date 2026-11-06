/**
 * VIDEO-TESTUMGEBUNG (2026-11-06) — FakeVideoProvider.
 *
 * Erfüllt den Anbieter-Vertrag (`submit → status → fetchResult`) vollständig,
 * OHNE je das Netz zu berühren: kein `fetch`, kein SDK, keine URL. Er erzeugt
 * das „Testvideo" lokal und deterministisch aus der Anfrage.
 *
 * EHRLICH ZUM ERGEBNIS: die Bytes sind eine container-konforme MP4-HÜLLE
 * (`ftyp` + `free` + `mdat`), **kein abspielbares Video**. Ein echtes
 * Abspielbarkeits-/Stitching-Prüfstück braucht FFmpeg — das ist ausdrücklich
 * ein Folgeauftrag (FFmpeg-Stitching war nicht Teil dieses Auftrags). Wer hier
 * „fertiges MP4" liest, meint: „Datei mit korrektem Container-Kopf, richtiger
 * Größe und stabilem Hash" — nicht „1080p-H.264 mit Ton".
 */

import {
  type VideoClipRequest,
  type VideoClipResult,
  type VideoJobStatus,
  type VideoProvider,
  type VideoProviderCaps,
  VideoError,
} from './types';

export interface FakeVideoProviderOptions {
  /** Wie viele `status()`-Aufrufe `processing` liefern, bevor `succeeded` kommt. */
  pollsUntilDone?: number;
  /** true = der Auftrag scheitert beim ersten `status()` (Fehlerpfad-Test). */
  fail?: boolean;
  /** Fehlercode für den Fehlerpfad (normalisiert, keine Rohantwort). */
  failCode?: string;
  /** Läuft der Auftrag nie fertig (Abbruch-/Timeout-Test). */
  neverFinishes?: boolean;
}

const CAPS: VideoProviderCaps = {
  maxClipSeconds: 10, // Owner-Grenze; der Anbieter könnte 15
  minClipSeconds: 3,
  supportsEndImage: true, // der Fake kann alles — er muss es nur melden
  supportsElement: false,
  supportsMultiShot: false,
  acceptsBase64Image: true,
  reportsBilling: false,
};

/** Deterministischer 32-bit-FNV-1a-Hash über einen String. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Ein MP4-Box-Kopf (Größe + Typ) — reine Byte-Arithmetik, kein Codec. */
function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length, false);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Baut die MP4-Hülle eines Clips. Gleiche Anfrage ⇒ gleiche Bytes
 * (deterministisch, kein Zufall, keine Zeit).
 */
export function buildFakeMp4(req: VideoClipRequest): Uint8Array {
  const encoder = new TextEncoder();
  // ftyp: major brand 'isom', minor 512, compatible 'isom','iso2','mp41'
  const ftyp = box(
    'ftyp',
    concat([
      encoder.encode('isom'),
      new Uint8Array([0x00, 0x00, 0x02, 0x00]),
      encoder.encode('isomiso2mp41'),
    ]),
  );
  // free: Platzhalter, wie ihn echte Encoder schreiben
  const free = box('free', encoder.encode('Growimo FakeVideoProvider (kein echtes Video)'));
  // mdat: deterministischer Inhalt, Länge ∝ Dauer
  const seed = fnv1a(`${req.externalTaskId}|${req.durationSeconds}|${req.prompt}`);
  const bytesPerSecond = 2048;
  const payload = new Uint8Array(req.durationSeconds * bytesPerSecond);
  for (let i = 0; i < payload.length; i += 1) {
    payload[i] = (seed + Math.imul(i, 31)) & 0xff;
  }
  const mdat = box('mdat', payload);
  return concat([ftyp, free, mdat]);
}

interface FakeJob {
  request: VideoClipRequest;
  polls: number;
  status: 'processing' | 'succeeded' | 'failed';
  errorCode?: string;
}

/**
 * Der Fake-Anbieter. Bewusst OHNE `Date.now()`: „Zeit" ist hier ein Zähler,
 * damit die Poll-Zustandsmaschine ohne Timer testbar bleibt.
 */
export class FakeVideoProvider implements VideoProvider {
  readonly id = 'fake' as const;
  readonly model = 'fake-test-video-1';
  readonly caps = CAPS;

  private readonly options: Required<Pick<FakeVideoProviderOptions, 'pollsUntilDone' | 'fail' | 'neverFinishes'>> &
    Pick<FakeVideoProviderOptions, 'failCode'>;
  private readonly jobs = new Map<string, FakeJob>();
  /** Zähler für Nachweise im Test („wie oft wurde wirklich etwas getan"). */
  readonly calls = { submit: 0, status: 0, fetchResult: 0, cancel: 0 };

  constructor(options: FakeVideoProviderOptions = {}) {
    this.options = {
      pollsUntilDone: options.pollsUntilDone ?? 1,
      fail: options.fail ?? false,
      neverFinishes: options.neverFinishes ?? false,
      failCode: options.failCode,
    };
  }

  async submit(req: VideoClipRequest): Promise<{ providerJobId: string; model: string }> {
    this.calls.submit += 1;
    if (this.jobs.has(req.externalTaskId)) {
      // Anbieter-Idempotenz: derselbe externe Task liefert denselben Auftrag.
      return { providerJobId: req.externalTaskId, model: this.model };
    }
    this.jobs.set(req.externalTaskId, {
      request: req,
      polls: 0,
      status: this.options.fail ? 'failed' : 'processing',
      errorCode: this.options.fail ? this.options.failCode ?? 'provider_failed' : undefined,
    });
    return { providerJobId: req.externalTaskId, model: this.model };
  }

  async status(providerJobId: string): Promise<VideoJobStatus> {
    this.calls.status += 1;
    const job = this.jobs.get(providerJobId);
    if (!job) throw new VideoError('unknown_job', `Unbekannter Fake-Auftrag: ${providerJobId}`);
    if (job.status === 'failed') return { state: 'failed', errorCode: job.errorCode };
    if (job.status === 'succeeded') return { state: 'succeeded' };
    if (this.options.neverFinishes) return { state: 'processing' };
    job.polls += 1;
    if (job.polls >= this.options.pollsUntilDone) {
      job.status = 'succeeded';
      return { state: 'succeeded' };
    }
    return { state: 'processing' };
  }

  async fetchResult(providerJobId: string): Promise<VideoClipResult> {
    this.calls.fetchResult += 1;
    const job = this.jobs.get(providerJobId);
    if (!job) throw new VideoError('unknown_job', `Unbekannter Fake-Auftrag: ${providerJobId}`);
    if (job.status !== 'succeeded') {
      throw new VideoError('not_ready', `Ergebnis noch nicht fertig (${job.status})`);
    }
    return { bytes: buildFakeMp4(job.request), contentType: 'video/mp4' };
  }

  async cancel(providerJobId: string): Promise<void> {
    this.calls.cancel += 1;
    this.jobs.delete(providerJobId);
  }
}
