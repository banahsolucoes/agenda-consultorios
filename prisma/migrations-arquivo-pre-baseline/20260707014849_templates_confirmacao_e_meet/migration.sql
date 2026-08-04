-- AlterTable
ALTER TABLE "Clinica" ADD COLUMN     "templateConfirmacao" TEXT NOT NULL DEFAULT '{saudacao} {paciente}, tudo bem?! 
🌸 Passando para confirmar sua sessão no dia {data} às {hora}hr. 🗓
👉 Podemos confirmar? ✅
⸻
⚠️ Importante
Caso não haja confirmação até hoje, às {horarioLimite}hr, o horário será automaticamente cancelado.
Um abraço

{assistente} 🥰',
ADD COLUMN     "templateMeet" TEXT NOT NULL DEFAULT '{saudacao} {paciente}, tudo bem? ☀️

Segue o link da sua sessão de hoje.
🔗 {linkMeet} 🔗

Qualquer coisa, estou por aqui.

{assistente} 🥰';
