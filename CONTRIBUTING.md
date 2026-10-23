# Contribuer

Ce dépôt améliore le [projet de EsteG7](https://github.com/EsteG7/francestudents-ide). Conserve le crédit d’origine et distingue les améliorations du fork des fonctions présentes en amont.

## Reprendre le projet avec une IA

Le point d’entrée commun est [AGENTS.md](AGENTS.md). Le [contexte de reprise](docs/AI_CONTEXT.md) décrit l’architecture, les invariants et l’état de validation. Il peut être donné à n’importe quel modèle sous forme de texte ou de fichiers du dépôt. Les fichiers `CLAUDE.md`, `GEMINI.md` et `.github/copilot-instructions.md` renvoient aux mêmes sources ; ne pas y maintenir des copies divergentes.

## En local

Avec Node.js 22.13.0 ou plus récent, npm et Git :

```powershell
npm install
npm run desktop
```

Avant une pull request, exécute les vérifications adaptées :

```powershell
npm run lint
npm run build:renderer
npm run check:renderer
npm test
npm run test:e2e
```

Les tests Electron nécessitent un environnement graphique. `npm test` isole les préférences et historiques dans des dossiers temporaires par processus. Pour un test unitaire ciblé, utiliser `node --require ./test/helpers/isolate-env.cjs --test test/nom.test.js`.

Ne versionne jamais de jeton, mot de passe, session ou fichier `.env`. Les dépendances, `dist/`, les fichiers vendor et les exécutables `release/` restent hors du code versionné. **Exception : `desktop/renderer/app.js` est un bundle généré et versionné** ; modifier `desktop/renderer/src/*.js`, puis le reconstruire avec `npm run build:renderer`.

La construction de l’application vérifie aussi le paquet EffectCraft modifié. Avant un premier `build:desktop` ou `dist:win`, lance `npm run vendor:effectcraft` avec les [prérequis Rust et WASM](docs/avance.md#motion-design-avec-effectcraft--bêta). Les workflows reconstruisent et mettent en cache ce paquet depuis la révision et le correctif épinglés ; ils ne substituent pas l’interface officielle non adaptée.

## Proposer une amélioration

Ouvre une pull request dans ce fork. Décris le problème, le comportement obtenu et les vérifications réalisées. Pour un bogue, indique la version, le système et les étapes de reproduction, sans identifiants ni données sensibles.

## Préparer une release

1. Mettre à jour la version, le changelog et le résumé de nouveautés dans `desktop/release-highlights.js`.
2. Vérifier le code, construire les exécutables et contrôler leur démarrage.
3. Créer une release sur un tag correspondant aux sources construites.
4. Joindre uniquement l’installateur, `.blockmap`, `latest.yml` et les empreintes SHA-256.

Les exécutables vont dans GitHub Releases, jamais dans Git. Les notes de version rappellent que le projet est de EsteG7 et que ce dépôt est un fork d’amélioration.

Le nom du produit est FranceStudent IDE. Les noms de fichiers à joindre viennent de `package.json` (`build.nsis.artifactName`) ; ne pas recopier un ancien nom FranceStudentCode depuis une release historique. Conserver l’`appId` et le dossier de données historique pour que le renommage ne perde pas les profils.

Construction locale Windows utilisée pour la validation :

```powershell
npm run build:renderer
npm run check:effectcraft
npx electron-builder --win nsis --publish never --config.npmRebuild=false
```

Cette option conserve les binaires précompilés de `node-pty` au lieu d’exiger les bibliothèques Spectre des outils Visual Studio. Vérifier le terminal dans l’application empaquetée. En cas de verrou Windows/OneDrive, choisir un dossier de sortie distinct avec `--config.directories.output=...`.

Le workflow **Publier les exécutables Windows** se déclenche à la publication d’une release. Le tag doit être exactement `v` suivi de la version du `package.json` de ce tag. Il vérifie le code, construit uniquement l’installateur, calcule les empreintes et joint les fichiers de mise à jour. Si tous les fichiers sont déjà joints, il les conserve. Il peut être relancé manuellement avec le tag d’une release existante. Les Actions GitHub doivent être activées dans ce fork.

Le tag doit correspondre à la version exacte du paquet. Après publication explicite, attendre que le workflow réussisse et que les quatre fichiers soient présents. Un simple push du code, un brouillon ou un tag sans release publiée ne déclenche pas cette publication Windows. Vérifier que les Actions sont activées dans le fork ; leur présence dans le dépôt ne suffit pas.

Pour une publication manuelle avec `gh`, préciser `-R extraopaa/francestudents-ide`, calculer `SHA256SUMS.txt`, puis joindre uniquement les quatre assets prévus. Ne jamais déplacer un tag déjà public pour y ajouter des modifications. Une demande de contribution ou de test ne demande pas implicitement un push ou une release.

Les versions portables restent exclusivement locales et ne doivent jamais accompagner une nouvelle release GitHub.
