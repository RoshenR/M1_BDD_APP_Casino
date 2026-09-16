import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { type ReactNode } from 'react';
import { session } from './lib/api';
import { FournisseurSolde, jetons, useSolde } from './lib/solde';

import { Connexion } from './pages/Connexion';
import { Inscription } from './pages/Inscription';
import { Lobby } from './pages/Lobby';
import { Roulette } from './pages/Roulette';
import { Machine } from './pages/Machine';
import { Blackjack } from './pages/Blackjack';
import { Profil } from './pages/Profil';
import { Classement } from './pages/Classement';

function Protege({ children }: { children: ReactNode }) {
  return session.token() ? <>{children}</> : <Navigate to="/connexion" replace />;
}

function Entete() {
  const { solde } = useSolde();
  const joueur = session.joueur();
  const naviguer = useNavigate();

  const lien = ({ isActive }: { isActive: boolean }) => (isActive ? 'actif' : '');

  return (
    <header className="entete">
      <span className="marque">♠ Casino</span>
      <nav className="nav">
        <NavLink to="/" end className={lien}>Salon</NavLink>
        <NavLink to="/roulette" className={lien}>Roulette</NavLink>
        <NavLink to="/machine" className={lien}>Machine</NavLink>
        <NavLink to="/blackjack" className={lien}>Blackjack</NavLink>
        <NavLink to="/classement" className={lien}>Classement</NavLink>
        {joueur && <NavLink to="/profil" className={lien}>Profil</NavLink>}
      </nav>

      {joueur ? (
        <>
          <span className="solde">{jetons(solde)} jetons</span>
          <button
            onClick={() => {
              session.fermer();
              naviguer('/connexion');
            }}
          >
            Deconnexion
          </button>
        </>
      ) : (
        <NavLink to="/connexion">Connexion</NavLink>
      )}
    </header>
  );
}

export function App() {
  return (
    <FournisseurSolde>
      <Entete />
      <main>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/connexion" element={<Connexion />} />
          <Route path="/inscription" element={<Inscription />} />
          <Route path="/classement" element={<Classement />} />
          <Route path="/roulette" element={<Protege><Roulette /></Protege>} />
          <Route path="/machine" element={<Protege><Machine /></Protege>} />
          <Route path="/blackjack" element={<Protege><Blackjack /></Protege>} />
          <Route path="/profil" element={<Protege><Profil /></Protege>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </FournisseurSolde>
  );
}
