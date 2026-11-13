/**
 * A plan's name for people, in sentence case: the API gives the plan code (FREE, STARTER, ...). The free plan has its own
 * translated name; the others are their code with only the first letter capital ("STARTER" -> "Starter").
 */
export const planName = (code: string, freeName: string): string =>
  code === "FREE" ? freeName : code.charAt(0) + code.slice(1).toLowerCase();
