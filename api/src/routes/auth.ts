/**
 * Inscription, connexion, rafraichissement, deconnexion.
 *
 * Point notable : l'API ne voit JAMAIS un mot de passe hache.
 * Le hachage (bcrypt via pgcrypto) se fait dans PostgreSQL, et le role
 * casino_api n'a pas le droit de lire la colonne mot_de_passe_hash.
 * Il ne peut qu'appeler inscrire() et authentifier().
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requete } from '../infra/postgres.js';
import {
  compterTentative,
  enregistrerSession,
  lireSession,
  reinitialiserTentatives,
  revoquerSession,
} from '../infra/redis.js';
import { ErreurHttp, traduireErreurPg } from '../erreurs.js';
import { config } from '../config.js';

const MAX_TENTATIVES = 8;

const schemaInscription = z.object({
  pseudo: z.string().min(3).max(24),
  email: z.string().email(),
  motDePasse: z.string().min(8).max(200),
  dateNaissance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  codeParrain: z.string().max(24).optional(),
});

const schemaConnexion = z.object({
  email: z.string().email(),
  motDePasse: z.string().min(1).max(200),
});

interface Compte {
  joueur_id: number;
  pseudo: string;
  role: string;
  statut: string;
}

export async function routesAuth(app: FastifyInstance): Promise<void> {
  /** Emet le couple access token (court) + refresh token (revocable via Redis). */
  async function emettreJetons(compte: Pick<Compte, 'joueur_id' | 'pseudo' | 'role'>) {
    const jti = randomUUID();
    await enregistrerSession(jti, compte.joueur_id);

    return {
      token: app.jwt.sign(
        { sub: String(compte.joueur_id), pseudo: compte.pseudo, role: compte.role },
        { expiresIn: config.jwtDuree },
      ),
      refresh: app.jwt.sign({ jti, type: 'refresh' }, { expiresIn: '7d' }),
      joueur: { id: compte.joueur_id, pseudo: compte.pseudo, role: compte.role },
    };
  }

  // ---------------------------------------------------------------------------
  app.post('/auth/inscription', async (req, reply) => {
    const corps = schemaInscription.parse(req.body);

    let cree;
    try {
      // Une seule instruction : creation du compte, verification de la majorite
      // (trigger), bonus de bienvenue et bonus de parrainage, le tout atomique.
      [cree] = await requete<{ joueur_id: number; pseudo: string; solde: number }>(
        'SELECT * FROM casino.inscrire($1, $2, $3, $4::date, $5)',
        [corps.pseudo, corps.email, corps.motDePasse, corps.dateNaissance, corps.codeParrain ?? null],
      );
    } catch (err) {
      throw traduireErreurPg(err);
    }
    if (!cree) throw new ErreurHttp(500, 'Inscription impossible');

    const jetons = await emettreJetons({ joueur_id: cree.joueur_id, pseudo: cree.pseudo, role: 'joueur' });
    return reply.code(201).send({ ...jetons, solde: cree.solde });
  });

  // ---------------------------------------------------------------------------
  app.post('/auth/connexion', async (req) => {
    const corps = schemaConnexion.parse(req.body);

    // Freinage des attaques par force brute : compteur Redis par email.
    const tentatives = await compterTentative(corps.email.toLowerCase());
    if (tentatives > MAX_TENTATIVES) {
      throw new ErreurHttp(429, 'Trop de tentatives. Reessayez dans quelques minutes.');
    }

    // authentifier() compare le hash DANS la base : le mot de passe ne
    // ressort jamais, et l'API n'a aucun acces a la colonne.
    const [compte] = await requete<Compte>(
      'SELECT * FROM casino.authentifier($1, $2)',
      [corps.email, corps.motDePasse],
    );

    if (!compte) throw new ErreurHttp(401, 'Email ou mot de passe incorrect');
    if (compte.statut === 'suspendu') throw new ErreurHttp(403, 'Compte suspendu');

    await reinitialiserTentatives(corps.email.toLowerCase());
    return emettreJetons(compte);
  });

  // ---------------------------------------------------------------------------
  app.post('/auth/refresh', async (req) => {
    const { refresh } = z.object({ refresh: z.string() }).parse(req.body);

    let charge: { jti: string; type: string };
    try {
      charge = app.jwt.verify(refresh);
    } catch {
      throw new ErreurHttp(401, 'Refresh token invalide');
    }
    if (charge.type !== 'refresh') throw new ErreurHttp(401, 'Jeton de mauvais type');

    // La revocation est reelle : si la cle Redis a saute, le jeton est mort,
    // meme s'il n'a pas encore expire. C'est tout l'interet du couple JWT court
    // + refresh stocke.
    const joueurId = await lireSession(charge.jti);
    if (joueurId === null) throw new ErreurHttp(401, 'Session expiree ou revoquee');

    const [j] = await requete<{ id: number; pseudo: string; role: string }>(
      'SELECT id, pseudo, role FROM casino.joueurs WHERE id = $1',
      [joueurId],
    );
    if (!j) throw new ErreurHttp(401, 'Compte introuvable');

    await revoquerSession(charge.jti);   // rotation : un refresh ne sert qu'une fois
    return emettreJetons({ joueur_id: j.id, pseudo: j.pseudo, role: j.role });
  });

  // ---------------------------------------------------------------------------
  app.post('/auth/deconnexion', async (req) => {
    const { refresh } = z.object({ refresh: z.string().optional() }).parse(req.body ?? {});
    if (refresh) {
      try {
        const charge: { jti?: string } = app.jwt.verify(refresh);
        if (charge.jti) await revoquerSession(charge.jti);
      } catch {
        /* jeton deja invalide : rien a revoquer */
      }
    }
    return { ok: true };
  });
}
