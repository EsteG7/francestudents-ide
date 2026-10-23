# Validation générale — FranceStudent IDE 1.3.3

Validation locale Windows du 23 octobre 2026, sur les sources destinées à la version 1.3.3. Environnement : Node 24.21.0, Electron 38.8.6, Windows x64.

## Résultats

| Contrôle | Résultat |
| --- | --- |
| Suite unitaire complète (`npm test`) | 678 tests : 675 réussis, 0 échec, 3 ignorés |
| Suite Electron complète | 25 parcours réussis, 0 échec |
| Régression historique après correction des anciens titres | 2 parcours Electron réussis |
| Lint | 0 erreur ; 1 avertissement préexistant dans le traitement des erreurs GitHub |
| Bundle renderer | À jour, syntaxe vérifiée |
| Moteur EffectCraft embarqué | Version et empreintes vérifiées |
| Compilation TUI | Réussie |
| Construction Windows NSIS | Réussie ; contrôlée séparément de l’installation |
| Application Windows empaquetée | Démarrage, version, terminal natif, EffectCraft et skills vérifiés |

Les trois tests ignorés concernent les hooks Unix et sont explicitement désactivés sous Windows.

## Ce qui a été exercé

- Ouverture de l’IDE, connexion guidée, conservation du modèle après redémarrage et nouveautés affichées une fois par version.
- Historique long, actions restaurées, reprise après compaction, séparation des chats code/motion, ouverture d’un chat vide et suppression avec confirmation.
- Import de conversation Codex, choix du modèle, préparation du brouillon sans envoi prématuré.
- Dépôt de fichiers, lisibilité des captures, pièces jointes ajoutées pendant une tâche et rattachement au bon tour.
- Quota indisponible/épuisé/disponible, compte à rebours, vérification d’un reset, erreurs API illustrées et actualisation après 15 minutes simulées.
- Mode Éco, annulation/activation/désactivation, persistance, petits écrans et fenêtres secondaires harmonisées.
- Marketplace, installation/désinstallation des skills, ressources Remotion, activation, profils, MCP stdio de test et paramètres.
- GitHub : préparation et publication simulées d’une release, sans écriture sur un dépôt réel.
- File de tâches, édition et réorganisation, blocage, accès complet, annulation d’une action et poursuite de l’agent.
- Terminal réel avec PTY/xterm, commandes locales, serveur web démarré/arrêté depuis le chat, navigateur local, stockage et WebSocket.
- EffectCraft réel : initialisation du moteur, composition et texte, rendu PNG, sauvegarde, interface simple/avancée, tutoriels et plein écran du chat à plusieurs tailles.

## Correctifs issus de la validation

1. **Tests dépendants des préférences du compte.** Quatre anciens échecs provenaient des réglages réels chargés par les tests : le mode Full accès modifiait les confirmations et le chemin d’exécution des commandes. `npm test` utilise maintenant un dossier temporaire distinct par processus. Les quatre tests passent sans changer les règles d’accès de l’application ni les préférences de l’utilisateur.
2. **Titres antérieurs au titrage IA.** Les conversations enregistrées avant cette fonctionnalité sont marquées comme anciennes ; leur titre ne peut plus être remplacé par une proposition automatique. Un test protège ce cas.
3. **Test de la version empaquetée.** Le parcours de vérification ferme désormais l’écran de nouveautés avant de manipuler l’éditeur, comme le fait l’utilisateur.
4. **Continuité du profil après renommage.** La comparaison des métadonnées empaquetées 1.3.2/1.3.3 confirme le nom interne `project-frstcli`. Le profil doit rester dérivé de ce nom, sans forcer un nouveau dossier portant le nom commercial.

## Limites de cette validation

- Les fournisseurs IA, les quotas et les mutations GitHub sont simulés dans les scénarios automatisés. Ce contrôle ne valide pas les permissions d’un compte distant réel ni une session Roblox Studio réelle.
- Le moteur EffectCraft, le terminal, les commandes et les serveurs locaux sont réellement exécutés.
- L’installeur est compilé, mais n’a pas été installé par-dessus l’application principale de l’utilisateur. La vérification porte sur son application empaquetée extraite par le constructeur.
- Aucun test macOS/Linux ni test de session durant plusieurs heures n’a été effectué. Ces résultats ne garantissent pas l’absence de tout bug.
- Aucun push ni aucune release GitHub n’a été effectué pendant cette validation.

## Reproduction

```powershell
npm test
npm run lint
npm run check:renderer
npm run check:effectcraft
node --test --test-concurrency=4 e2e/*.e2e.test.js
npx electron-builder --win nsis --publish never --config.npmRebuild=false
```

Les journaux détaillés de cette session se trouvent localement dans `release/qa-general-*.log` (dossier ignoré par Git). Le test de l’exécutable empaqueté utilise `FRST_PACKAGED_EXE` avec `e2e/effectcraft.e2e.test.js` et un profil temporaire.
