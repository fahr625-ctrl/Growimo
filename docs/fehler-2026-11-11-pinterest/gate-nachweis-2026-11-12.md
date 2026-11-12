# Gate-Nachweis 2026-11-12 — echter Absage-Fall vom 11.11.2026

Ausgeführt: `bun scripts/phase1-gate-test.ts` (offline, kein Anbieter, keine DB, kein Bildaufruf).
Ergebnis: 26 PASS / 0 FAIL, Exit 0.

```

[1] Verweigerungserkennung — echter Fall 2026-11-11
  PASS  Absage wird erkannt
  PASS  Absage als Titel erkannt
  PASS  normales Ergebnis ist keine Absage
  PASS  Echfall-Objekt besteht die Prüfung NICHT
  PASS  Echfall-Klassifikation = refusal
  PASS  Fehler trägt strukturellen Code REFUSAL

[2] Strukturprüfung
  PASS  vollständiges Pinterest-Ergebnis besteht
  PASS  vollständiges Etsy-Ergebnis besteht
  PASS  leerer Body = unvollständig
  PASS  Parser-Fallback-Titel „Pin-Titel" = unvollständig
  PASS  ohne Keywords = unvollständig
  PASS  ohne Tags = unvollständig
  PASS  abgeschriebener Prompt = unvollständig

[3] Gate → 1 Wiederholung → Fehler → Kontingent zurück
  PASS  A: Wiederholung liefert brauchbares Ergebnis
  PASS  A: genau 2 Provider-Aufrufe
  PASS  A: 1 Einheit verbraucht (Erfolg)
  PASS  B: Fehler nach zweiter Absage
  PASS  B: genau 2 Provider-Aufrufe
  PASS  B: Kontingent zurückgegeben (0 verbraucht)
  PASS  B: Code REFUSAL im Fehler

[4] Drei Kacheln
  PASS  genau 2 generierende Kacheln
  PASS  genau 3 sichtbare Kacheln
  PASS  Pinterest + Etsy generierbar
  PASS  TikTok führt ins bestehende Modul
  PASS  alte Typen sind nicht mehr wählbar
  PASS  die alten Typen bleiben in der Registry

26 PASS / 0 FAIL
```
