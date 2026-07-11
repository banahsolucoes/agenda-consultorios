-- CreateIndex
CREATE UNIQUE INDEX "Paciente_clinicaId_cpf_key" ON "Paciente"("clinicaId", "cpf");
