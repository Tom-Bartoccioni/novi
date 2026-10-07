'use client';

import { Button } from '@/components/ui/button';

/** Déclenche l'impression du navigateur : « Enregistrer au format PDF » y est proposé partout. */
export function PrintButton() {
  return (
    <Button type="button" size="sm" onClick={() => window.print()}>
      Imprimer / PDF
    </Button>
  );
}
