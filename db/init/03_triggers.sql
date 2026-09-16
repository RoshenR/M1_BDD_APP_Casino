-- =============================================================================
-- 03 · DECLENCHEURS
-- =============================================================================
-- MODULE 04. Rappel de la slide 48 : on n'ecrit un trigger que lorsqu'aucune
-- contrainte declarative ne suffit. Chacun est donc justifie en commentaire,
-- et documente avec COMMENT ON (« pas de logique cachee »).
--
--   BEFORE : peut modifier NEW ou annuler l'operation
--   AFTER  : voit la ligne ecrite — audit, propagation
-- =============================================================================

\echo '=== 03 · declencheurs ==='

SET search_path = casino, public;


-- =============================================================================
-- 1. BEFORE — maintenir maj_le
-- =============================================================================
-- Pourquoi un trigger : un DEFAULT ne joue qu'a l'INSERT. Et on ne veut pas
-- compter sur l'application (slide 46) : pgAdmin et les scripts doivent aussi
-- mettre la colonne a jour.
--
-- UPDATE OF : on ne se declenche pas quand seul le solde bouge, sinon chaque
-- mise toucherait la ligne joueur pour rien (slide 48 : « ligne a ligne = cout »).
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_maj_le()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.maj_le := now();
  RETURN NEW;
END $$;

CREATE TRIGGER joueurs_maj_le
BEFORE UPDATE OF pseudo, email, mot_de_passe_hash, statut, role, limite_mise, exclu_jusqu_au
ON joueurs
FOR EACH ROW
EXECUTE FUNCTION trg_maj_le();

COMMENT ON TRIGGER joueurs_maj_le ON joueurs IS 'Horodate les modifications de profil. Volontairement insensible aux variations de solde.';


-- =============================================================================
-- 2. BEFORE — normaliser et valider un compte
-- =============================================================================
-- Deux choses qu'un CHECK ne sait pas faire :
--   · normaliser (lower / trim) : un CHECK refuse, il ne corrige pas
--   · comparer a now() : un CHECK doit etre immuable, il ne peut pas lire l'heure
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_normaliser_joueur()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.email  := lower(trim(NEW.email));
  NEW.pseudo := trim(NEW.pseudo);

  -- Majorite : impossible en CHECK (age() n'est pas immuable).
  IF NEW.date_naissance > (current_date - interval '18 years') THEN
    RAISE EXCEPTION 'Inscription reservee aux majeurs (ne le %)', NEW.date_naissance
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.date_naissance < current_date - interval '120 years' THEN
    RAISE EXCEPTION 'Date de naissance invalide : %', NEW.date_naissance;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER joueurs_normaliser
BEFORE INSERT OR UPDATE OF email, pseudo, date_naissance ON joueurs
FOR EACH ROW
EXECUTE FUNCTION trg_normaliser_joueur();

COMMENT ON TRIGGER joueurs_normaliser ON joueurs IS 'Normalise email/pseudo et verifie la majorite (regle non exprimable en CHECK).';


-- =============================================================================
-- 3. BEFORE — pas de cycle dans le parrainage
-- =============================================================================
-- L'arbre de parrainage est parcouru en WITH RECURSIVE (module 01). Un cycle
-- ferait boucler la requete a l'infini : on l'interdit a l'ecriture.
-- La verification elle-meme est une CTE recursive — module 01 au service du 04.
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_parrainage_sans_cycle()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cycle boolean;
BEGIN
  IF NEW.parrain_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- On remonte la chaine des parrains depuis le parrain propose.
  -- Si on retombe sur NEW.id, le lien creerait une boucle.
  WITH RECURSIVE remontee AS (
    SELECT id, parrain_id, 1 AS profondeur
    FROM joueurs
    WHERE id = NEW.parrain_id

    UNION ALL

    SELECT j.id, j.parrain_id, r.profondeur + 1
    FROM joueurs j
    JOIN remontee r ON j.id = r.parrain_id
    WHERE r.profondeur < 100              -- garde-fou si une boucle existe deja
  )
  SELECT EXISTS (SELECT 1 FROM remontee WHERE id = NEW.id) INTO v_cycle;

  IF v_cycle THEN
    RAISE EXCEPTION 'Parrainage circulaire refuse : % ne peut pas etre parraine par %',
                    NEW.id, NEW.parrain_id;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER joueurs_parrainage_sans_cycle
BEFORE INSERT OR UPDATE OF parrain_id ON joueurs
FOR EACH ROW
EXECUTE FUNCTION trg_parrainage_sans_cycle();

COMMENT ON TRIGGER joueurs_parrainage_sans_cycle ON joueurs IS 'Garantit que l''arbre de parrainage reste un arbre : condition de terminaison du WITH RECURSIVE.';


-- =============================================================================
-- 4. BEFORE — refuser une mise interdite
-- =============================================================================
-- Le pendant exact du TP 04 Q5 (« refuser un billet pour un evenement deja
-- commence »). C'est le filet de securite : _valider_mise() donne le message
-- lisible, ce trigger garantit la regle meme si quelqu'un ecrit en direct.
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_verifier_mise()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_joueur joueurs;
BEGIN
  IF NEW.type <> 'mise' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_joueur FROM joueurs WHERE id = NEW.joueur_id;

  IF v_joueur.statut <> 'actif' THEN
    RAISE EXCEPTION 'Mise refusee : compte %', v_joueur.statut
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_joueur.exclu_jusqu_au IS NOT NULL AND v_joueur.exclu_jusqu_au > now() THEN
    RAISE EXCEPTION 'Mise refusee : auto-exclusion active jusqu''au %',
                    to_char(v_joueur.exclu_jusqu_au, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER transactions_verifier_mise
BEFORE INSERT ON transactions
FOR EACH ROW
WHEN (NEW.type = 'mise')                  -- WHEN : pas d'appel inutile (slide 47)
EXECUTE FUNCTION trg_verifier_mise();

COMMENT ON TRIGGER transactions_verifier_mise ON transactions IS 'Jeu responsable : aucune mise possible pour un compte suspendu ou auto-exclu, quel que soit le chemin d''ecriture.';


-- =============================================================================
-- 5. AFTER — propager le solde
-- =============================================================================
-- joueurs.solde est un cache du grand livre. Ce trigger est le seul endroit
-- qui l'ecrit : impossible de le desynchroniser depuis l'application.
-- verifier_integrite_soldes() doit rendre 0 ligne a tout instant.
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_maj_solde()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE joueurs SET solde = NEW.solde_apres WHERE id = NEW.joueur_id;
  RETURN NULL;                            -- ignore pour un AFTER
END $$;

CREATE TRIGGER transactions_maj_solde
AFTER INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION trg_maj_solde();

COMMENT ON TRIGGER transactions_maj_solde ON transactions IS 'Reporte solde_apres sur le cache joueurs.solde. Source de verite : sum(transactions.montant).';


-- =============================================================================
-- 6. BEFORE — le grand livre est immuable
-- =============================================================================
-- Une comptabilite ne se corrige pas, elle se contre-passe : on ecrit une ligne
-- inverse (voir rembourser_partie). Ce trigger rend UPDATE et DELETE impossibles
-- pour tout le monde, y compris le proprietaire des tables.
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_livre_immuable()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Le grand livre est immuable : % interdit sur transactions. Ecrivez un mouvement inverse.',
    TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER transactions_immuable
BEFORE UPDATE OR DELETE ON transactions
FOR EACH ROW
EXECUTE FUNCTION trg_livre_immuable();

COMMENT ON TRIGGER transactions_immuable ON transactions IS 'Append-only. Une correction se fait par contre-passation, jamais par UPDATE.';


-- =============================================================================
-- 7. AFTER — journal d'audit
-- =============================================================================
-- Reproduit le trigger audit_prix du cours (slide 47) et le journal_tarifs du
-- TP 04 Q4 : to_jsonb(OLD) / to_jsonb(NEW), une seule fonction pour plusieurs
-- tables grace a TG_TABLE_NAME et TG_OP.
--
-- ATTENTION AU COUT : ce trigger ne surveille QUE les colonnes sensibles.
-- Auditer joueurs.solde ecrirait une ligne a chaque mise — des millions de
-- lignes pour rien (slide 48).
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_audit()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_avant jsonb;
  v_apres jsonb;
BEGIN
  -- On teste TG_OP avant de toucher a OLD / NEW : dans un trigger INSERT, OLD
  -- n'est pas affecte, et l'evaluer leverait « record old is not assigned yet ».
  IF TG_OP <> 'INSERT' THEN
    v_avant := to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_apres := to_jsonb(NEW);
  END IF;

  INSERT INTO journal_audit (table_cible, operation, cle, avant, apres)
  VALUES (TG_TABLE_NAME, TG_OP,
          coalesce(v_apres, v_avant)->>'id',
          v_avant, v_apres);

  RETURN NULL;
END $$;

-- Changement de statut, de role ou de limite : tout ce qui touche aux droits.
CREATE TRIGGER joueurs_audit
AFTER UPDATE OF statut, role, limite_mise, exclu_jusqu_au OR DELETE ON joueurs
FOR EACH ROW
EXECUTE FUNCTION trg_audit();

-- Modification du catalogue : bornes de mise, ouverture / fermeture d'un jeu.
CREATE TRIGGER jeux_audit
AFTER UPDATE OF mise_min, mise_max, rtp_theorique, actif OR DELETE ON jeux
FOR EACH ROW
EXECUTE FUNCTION trg_audit();

-- Annulation / remboursement d'une partie : ca doit laisser une trace.
CREATE TRIGGER parties_audit
AFTER UPDATE OF statut ON parties
FOR EACH ROW
WHEN (NEW.statut = 'annulee')
EXECUTE FUNCTION trg_audit();

COMMENT ON TRIGGER joueurs_audit ON joueurs IS 'Historise les changements de droits et de statut. N''audite deliberement PAS le solde (volume).';


-- =============================================================================
-- 8. AFTER — amities symetriques, et le piege des cascades
-- =============================================================================
-- Une amitie va dans les deux sens. Un trigger qui insere dans SA PROPRE table
-- est exactement le cas dangereux de la slide 48 : A insere B, ce qui declenche
-- le trigger, qui insere A, qui declenche le trigger...
--
-- Deux garde-fous :
--   · pg_trigger_depth() = 1 : on ne reagit qu'a l'insertion d'origine
--   · le NOT EXISTS : idempotent de toute facon
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_amitie_symetrique()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;                          -- on est deja dans la cascade : stop
  END IF;

  INSERT INTO amities (joueur_id, ami_id)
  VALUES (NEW.ami_id, NEW.joueur_id)
  ON CONFLICT DO NOTHING;

  RETURN NULL;
END $$;

CREATE TRIGGER amities_symetrie
AFTER INSERT ON amities
FOR EACH ROW
EXECUTE FUNCTION trg_amitie_symetrique();

COMMENT ON TRIGGER amities_symetrie ON amities IS 'Insere le lien reciproque. pg_trigger_depth() coupe la recursion infinie (slide 48, cascades).';
