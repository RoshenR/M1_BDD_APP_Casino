/**
 * =============================================================================
 * Des erreurs PostgreSQL aux erreurs HTTP
 * =============================================================================
 * Toutes les regles metier sont dans la base, sous forme de RAISE EXCEPTION
 * avec des messages ecrits pour etre lus par un humain :
 *
 *   RAISE EXCEPTION 'Mise hors bornes pour % : attendu entre % et % (recu : %)'
 *   RAISE EXCEPTION 'Auto-exclusion active jusqu''au %'
 *   RAISE EXCEPTION 'Solde insuffisant : il manque % jetons'
 *
 * L'API ne les reecrit pas : elle les traduit en code HTTP et les transmet.
 * C'est le benefice concret de « mettre la logique dans la base » : une seule
 * definition de la regle, un seul message, valable pour le web comme pour un
 * script ou pgAdmin.
 * =============================================================================
 */

export class ErreurHttp extends Error {
  constructor(
    public readonly statut: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

interface ErreurPg {
  code?: string;
  message?: string;
  constraint?: string;
}

/** Contraintes de la base -> message lisible cote front. */
const MESSAGES_CONTRAINTE: Record<string, string> = {
  joueurs_pseudo_format: 'Pseudo invalide : 3 a 24 caracteres, lettres, chiffres, - et _ uniquement.',
  joueurs_email_format: "Format d'email invalide.",
  joueurs_solde_positif: 'Solde insuffisant.',
  transactions_solde_positif: 'Solde insuffisant.',
  jeux_mises_coherentes: 'Bornes de mise incoherentes.',
  parties_mise_positive: 'La mise doit etre strictement positive.',
};

export function traduireErreurPg(err: unknown): ErreurHttp {
  const e = err as ErreurPg;

  if (e?.constraint && MESSAGES_CONTRAINTE[e.constraint]) {
    return new ErreurHttp(400, MESSAGES_CONTRAINTE[e.constraint]!, e.constraint);
  }

  switch (e?.code) {
    // RAISE EXCEPTION sans ERRCODE explicite : nos regles metier.
    case 'P0001':
      return new ErreurHttp(400, e.message ?? 'Operation refusee', e.code);

    // RAISE ... USING ERRCODE = 'check_violation', et les CHECK de la base.
    case '23514':
      return new ErreurHttp(400, e.message ?? 'Contrainte non respectee', e.code);

    // _exiger_identite() et les GRANT refuses.
    case '42501':
      return new ErreurHttp(403, 'Acces refuse', e.code);

    case '23505':
      return new ErreurHttp(409, 'Cette valeur est deja utilisee', e.code);

    case '23503':
      return new ErreurHttp(409, 'Reference inexistante', e.code);

    case 'P0002':
      return new ErreurHttp(404, e.message ?? 'Introuvable', e.code);

    // Le grand livre est immuable, et autres violations d'integrite.
    case '23000':
      return new ErreurHttp(409, e.message ?? 'Operation interdite', e.code);

    default:
      return new ErreurHttp(500, 'Erreur interne');
  }
}
