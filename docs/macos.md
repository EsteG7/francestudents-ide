# Version macOS bêta

La version Mac est une préversion distincte de la version Windows stable. Elle affiche un avertissement bêta à chaque démarrage.

- Apple Silicon : choisir le fichier `mac-arm64.dmg`.
- Intel : choisir le fichier `mac-x64.dmg`.
- Ouvrir le DMG et déplacer FranceStudent IDE dans Applications.

La version n’est pas notariée par Apple. macOS peut demander une autorisation dans Réglages système > Confidentialité et sécurité. À partir de la bêta 1.3.3-mac.2, l’IDE vérifie les nouvelles versions au démarrage puis toutes les quatre heures si la préférence de mise à jour est activée. Le bouton de téléchargement ouvre le bon DMG pour Intel ou Apple Silicon dans le navigateur. L’installation reste manuelle : ouvre le DMG et remplace l’application dans Applications. La bêta précédente doit être remplacée une première fois manuellement pour obtenir cette fonction.

Le workflow `release-mac.yml` construit chaque architecture sur un runner natif, lance les tests unitaires puis vérifie le terminal, le vrai moteur EffectCraft, le rendu d’image, la sauvegarde, les modes Simple/Avancé et le chat plein écran dans l’application empaquetée. Les captures et empreintes accompagnent les artefacts Actions.

Les préversions dont le numéro contient `-mac.` ne déclenchent pas la publication Windows. Les fichiers Windows déjà publiés restent inchangés.
