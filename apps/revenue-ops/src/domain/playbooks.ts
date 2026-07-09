import type {
  ActionRecommendation,
  CollectionsSignals,
  Priority,
  RetentionSignals,
} from "./types.js";

export function retentionPlaybook(
  score: number,
  priority: Priority,
  signals: RetentionSignals,
): ActionRecommendation[] {
  const actions: ActionRecommendation[] = [
    {
      title: "Apri task AM con riepilogo rischio churn",
      rationale: `Score ${score}/100 con priorità ${priority}; serve allineamento immediato AM.`,
      channel: "crm_task",
      requiresApproval: false,
    },
  ];

  if (signals.renewalDaysLeft <= 45) {
    actions.push({
      title: "Invia email proattiva di renewal check-in",
      rationale: "Renewal in finestra critica, serve contatto anticipato.",
      channel: "email",
      requiresApproval: false,
    });
  }

  if (score >= 65) {
    actions.push({
      title: "Proponi call executive sponsor + piano di recupero adozione",
      rationale: "Rischio elevato: serve intervento strategico e piano strutturato.",
      channel: "crm_task",
      requiresApproval: true,
    });
  }

  return actions;
}

export function collectionsPlaybook(
  score: number,
  priority: Priority,
  signals: CollectionsSignals,
): ActionRecommendation[] {
  const actions: ActionRecommendation[] = [
    {
      title: "Invia reminder personalizzato con riepilogo posizione",
      rationale: `Fase iniziale collections, score ${score}/100 e priorità ${priority}.`,
      channel: "email",
      requiresApproval: false,
    },
    {
      title: "Apri task CRM per monitoraggio outcome",
      rationale: "Serve tracciamento operativo centralizzato per AM/finance.",
      channel: "crm_task",
      requiresApproval: false,
    },
  ];

  if (signals.daysPastDue >= 45 || signals.hasBrokenPromise) {
    actions.push({
      title: "Proponi piano standard rateale",
      rationale: "Debito persistente: aumentare probabilità di recupero con piano strutturato.",
      channel: "email",
      requiresApproval: false,
    });
  }

  if (score >= 85) {
    actions.push({
      title: "Escalation pre-legale",
      rationale: "Alta severità: messaggio critico richiede approvazione umana obbligatoria.",
      channel: "email",
      requiresApproval: true,
    });
  }

  return actions;
}
