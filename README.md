# J.A.R.V.I.S. BR — projeto inicial Android

Projeto inicial para Windows sem Android Studio. Inclui:
- Aplicativo Android nativo com interface escura futurista
- Entrada por texto, reconhecimento de voz em português e respostas faladas (TTS)
- Modo demonstração local
- Backend Node.js preparado para conectar a um provedor de IA
- GitHub Actions para compilar APK de teste sem Android Studio

## Gerar o APK pelo GitHub (Windows, sem Android Studio)

1. Extraia esta pasta.
2. No GitHub, crie um repositório chamado `jarvis-br-android`.
3. Envie todos os arquivos desta pasta para a raiz do repositório (incluindo `.github`).
4. Abra a aba **Actions** do repositório.
5. Se necessário, permita workflows nas configurações.
6. Execute **Build JARVIS BR APK** em **Run workflow**, ou faça um commit na branch `main`.
7. Abra a execução concluída e baixe o artefato **JARVIS-BR-debug-apk**.
8. Extraia o ZIP do artefato e instale `app-debug.apk` no Android. Talvez seja necessário permitir instalação de apps desta origem.

## Como configurar a IA online

O app já funciona em modo demonstração. Para IA real:
1. Hospede `backend/` em um serviço Node.js com HTTPS.
2. Defina as variáveis de ambiente `AI_API_URL`, `AI_API_KEY`, `AI_MODEL` e `PORT` no serviço.
3. No arquivo `app/src/main/java/br/com/jarvisbr/MainActivity.kt`, troque `https://SEU-BACKEND.example.com/chat` pela URL HTTPS real do backend.
4. Envie a alteração ao GitHub para gerar novo APK.

O backend espera uma API compatível com o formato de chat completions (`messages` e `choices[0].message.content`). Ajuste o código se o provedor usar outro formato.

**Segurança:** nunca coloque sua chave de API no app Android, em repositório público ou no APK. Guarde-a somente nas variáveis de ambiente do backend.

## Observações
- Este é um protótipo funcional inicial, não um assistente de sistema completo.
- Reconhecimento de voz depende dos serviços de voz disponíveis no aparelho e pode exigir internet.
- O APK gerado pelo workflow é de depuração; não é um APK de publicação assinado.
