# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Oxímetro real (puente Bluetooth)

La app lee el oxímetro a través de `puente-oximetro/` (ver su README). Pasos:

1. Copia `.env.example` a `.env` (no se sube a git) y deja `EXPO_PUBLIC_SENSORES=oximetro_puente` con `EXPO_PUBLIC_PUENTE_OXIMETRO_URL`.
2. En otra terminal, desde `puente-oximetro/` (PowerShell):

   ```powershell
   $env:OXIMETRO_ID = "<dirección MAC del oxímetro>"
   python -m puente
   ```

3. Reinicia Expo con la caché limpia, porque las variables `EXPO_PUBLIC_*` se incrustan al compilar: `npx expo start -c`.
4. En el paso de mediciones, **Oxímetro** y **Oxímetro (FC de recuperación)** usan el dispositivo real; tensiómetro, balanza y prueba de esfuerzo siguen simulados.

Según dónde corra la app:

| App en | `EXPO_PUBLIC_PUENTE_OXIMETRO_URL` | Puente |
| --- | --- | --- |
| Navegador del mismo PC (`npx expo start --web`) | `http://localhost:8765` | `$env:PUENTE_ORIGENES = "http://localhost:8081"` (sin esto el navegador bloquea la petición por CORS) |
| Emulador Android | `http://10.0.2.2:8765` | por defecto |
| Celular o tablet | `http://<IP del PC>:8765` | `$env:PUENTE_HOST = "0.0.0.0"` y `PUENTE_TOKEN` (la misma clave en `EXPO_PUBLIC_PUENTE_OXIMETRO_KEY`) |

Android bloquea `http://` en builds de producción; en desarrollo funciona.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
