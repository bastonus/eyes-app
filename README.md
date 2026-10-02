# 🐲 Dragon Eyes Sync - Effet Spécial OLED Multi-Écrans

Application web interactive conçue pour synchroniser deux téléphones à écran OLED affichant chacun un œil de dragon, pilotés à distance par une régie maître (avec audio Bluetooth).

---

## ✨ Fonctionnalités Principales

### 👁️ Mode Téléphones (Écrans OLED)
- **Noir Absolu OLED (`#000000`)** : Extinction totale des pixels entourant l'œil pour un contraste saisissant dans l'obscurité ou intégré dans une tête de dragon.
- **Anti-sommeil (Screen Wake Lock API)** : Empêche le téléphone de se mettre en veille ou d'éteindre son écran, même pendant de longues heures.
- **Mode Plein Écran Immersif** : Masque l'interface du navigateur en un geste.
- **Calibrage & Cadrage Tactile** :
  - **Pinch-to-zoom** (zoom à deux doigts) et **glisser-déplacer** pour ajuster précisément l'œil dans l'ouverture physique du dragon.
  - Curseurs de précision : Zoom, Position X, Position Y, Rotation et Inversion miroir.
  - Bouton **« Appliquer & Verrouiller »** : Sauvegarde les coordonnées dans la mémoire locale (`localStorage`), masque tous les contrôles et verrouille les gestes tactiles pour éviter tout décalage accidentel lors de la manipulation du téléphone.
  - Déverrouillage discret par **triple tape** dans le coin supérieur droit.

### 🎛️ Mode Régie / Maître
- **Lancement Unifié & Synchrone** : Lance simultanément l'audio sur l'appareil maître (connecté en Bluetooth à une sono) et les deux vidéos sur les téléphones.
- **Synchronisation Milliseconde (Horloge NTP)** :
  - Synchronisation temporelle haute précision via WebSocket.
  - Compensation automatique des micro-dérives (*drift*) en ajustant imperceptiblement la vitesse de lecture (`0.96x` à `1.04x`).
- **Boucle Parfaite** : Les deux vidéos et le son tournent en boucle continue sans désynchronisation.
- **Arrêt Propre en Fin de Cycle** :
  - Bouton *« Arrêter (Fin du cycle) »* : Les deux vidéos terminent leur lecture en cours jusqu'à la dernière frame avant de se mettre en veille (œil endormi/noir), sans coupure brutale.
  - Bouton *« Arrêt Immédiat »* en cas d'urgence.
- **Télémétrie en Direct** : Suivi de l'état de chaque téléphone (En ligne, Dérive en ms, État de lecture, Anti-veille actif).
- **QR Codes Intégrés** : Un clic pour afficher les QR codes et connecter les deux téléphones en 5 secondes sur le camp.

### 🎬 Traitement Vidéo & Découpage Automatique
- **Upload Direct depuis la Régie** : Uploadez une nouvelle vidéo contenant les deux yeux côte à côte.
- **Découpage au Milieu Automatique** :
  - Le serveur sonde automatiquement les dimensions de la vidéo ($W \times H$).
  - La moitié gauche ($[0 \to W/2]$) est découpée et encodée pour l'**Œil Gauche**.
  - La moitié droite ($[W/2 \to W]$) est découpée et encodée pour l'**Œil Droit**.
  - La piste audio est extraite automatiquement.
  - Formatage H.264 optimisé mobile (`yuv420p`, `+faststart`) pour un streaming instantané à faible charge processeur.
- **Upload de Pistes Audio Personnalisées** (MP3, WAV, M4A, OGG).

---

## 🚀 Démarrage Rapide

### En local (Node.js)

```bash
# Installer les dépendances
npm install

# Lancer le serveur
npm start
```

Le serveur sera accessible sur `http://localhost:3000` (ou sur l'IP locale de votre réseau, ex. `http://192.168.1.50:3000`).

---

## 🐳 Déploiement sur Coolify

L'application est prête à être déployée en 1 clic sur votre serveur **Coolify** :

### Méthode 1 : Déploiement via Dockerfile / Git
1. Connectez votre dépôt Git à Coolify.
2. Choisissez le type **Dockerfile** ou **Docker Compose**.
3. Définissez le port sur `3000`.
4. Cliquez sur **Deploy**.

### Méthode 2 : Déploiement avec `docker-compose.yml`
Le fichier `docker-compose.yml` inclus crée des volumes persistants pour conserver vos vidéos et audios téléversés :
```yaml
version: '3.8'

services:
  dragon-eyes:
    build: .
    container_name: dragon-eyes-sync
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
    volumes:
      - dragon_media:/app/media
      - dragon_uploads:/app/uploads

volumes:
  dragon_media:
  dragon_uploads:
```

---

## 📱 Guide d'Utilisation sur le Terrain (Camp)

1. **Régie (Téléphone / Tablette Maître)** :
   - Connectez le téléphone maître en **Bluetooth** à votre enceinte.
   - Ouvrez la page `/master`.
   - Cliquez sur *« Scanner QR Gauche »* et *« Scanner QR Droit »*.
2. **Téléphone Œil Gauche (OLED)** :
   - Scannez le QR code gauche.
   - Réglez la luminosité de l'écran du téléphone à **100%**.
   - Appuyez sur **« Toucher pour armer le lecteur »** (active le plein écran et l'anti-veille).
   - Ajustez le zoom et le centrage dans le dragon, puis cliquez sur **« Appliquer & Verrouiller »**.
3. **Téléphone Œil Droit (OLED)** :
   - Répétez l'opération pour l'œil droit.
4. **Lancement du Spectacle** :
   - Sur la Régie, vérifiez que les deux yeux affichent le voyant vert 🟢 *En ligne*.
   - Appuyez sur **🔥 LANCER LE SHOW**.
   - Quand la scène est terminée, appuyez sur **⏳ Arrêter (Fin du cycle)**.
