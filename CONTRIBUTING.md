# Contribuer

Ce dépôt améliore le [projet de EsteG7](https://github.com/EsteG7/francestudents-ide). Conserve le crédit d’origine et distingue les améliorations du fork des fonctions présentes en amont.

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

Les tests Electron nécessitent un environnement graphique. Ne versionne jamais de jeton, mot de passe, session ou fichier `.env`. Les dépendances, bundles générés et exécutables `release/` restent hors du code versionné.

## Proposer une amélioration

Ouvre une pull request dans ce fork. Décris le problème, le comportement obtenu et les vérifications réalisées. Pour un bogue, indique la version, le système et les étapes de reproduction, sans identifiants ni données sensibles.

## Préparer une release

1. Mettre à jour la version et le changelog.
2. Vérifier le code, construire les exécutables et contrôler leur démarrage.
3. Créer une release sur un tag correspondant aux sources construites.
4. Joindre uniquement l’installateur, `.blockmap`, `latest.yml` et les empreintes SHA-256.

Les exécutables vont dans GitHub Releases, jamais dans Git. Les notes de version rappellent que le projet est de EsteG7 et que ce dépôt est un fork d’amélioration.

Le workflow **Publier les exécutables Windows** se déclenche à la publication d’une release. Le tag doit être exactement `v` suivi de la version du `package.json` de ce tag. Il vérifie le code, construit uniquement l’installateur, calcule les empreintes et joint les fichiers de mise à jour. Si tous les fichiers sont déjà joints, il les conserve. Il peut être relancé manuellement avec le tag d’une release existante. Les Actions GitHub doivent être activées dans ce fork.

Par exemple, pour une version `1.1.4` : mettre à jour le paquet, committer et pousser, puis publier une release stable `v1.1.4` sur ce commit. Attendre que le workflow réussisse et que les quatre fichiers soient présents. Un simple push du code, un brouillon ou un tag sans release publiée ne déclenche pas cette publication Windows.

Les versions portables restent exclusivement locales et ne doivent jamais accompagner une nouvelle release GitHub.
