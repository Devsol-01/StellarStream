import { prisma } from "../lib/db.js";
import { NotFoundError, ConflictError, ValidationError } from "../lib/app-error.js";

export type RoutingConditionType = "amount" | "asset" | "geography" | "time";
export type RoutingOperator = "gte" | "lte" | "between" | "equals" | "in";

const VALID_TYPES: readonly RoutingConditionType[] = ["amount", "asset", "geography", "time"];

const VALID_OPERATORS_BY_TYPE: Record<RoutingConditionType, readonly RoutingOperator[]> = {
  amount: ["gte", "lte", "between"],
  asset: ["equals", "in"],
  geography: ["equals", "in"],
  time: ["between"],
};

export interface RoutingConditionInput {
  type: RoutingConditionType;
  operator: RoutingOperator;
  value: string;
  value2?: string;
}

export interface CreateRoutingRuleInput {
  ownerAddress: string;
  name: string;
  description?: string;
  route: string;
  priority?: number;
  isActive?: boolean;
  conditions: RoutingConditionInput[];
}

export interface UpdateRoutingRuleInput {
  name?: string;
  description?: string;
  route?: string;
  priority?: number;
  isActive?: boolean;
  conditions?: RoutingConditionInput[];
}

/** The payment being routed, evaluated against a rule's conditions. */
export interface PaymentRoutingContext {
  amount: string; // stroops, as a string (may exceed Number.MAX_SAFE_INTEGER)
  tokenAddress: string;
  region?: string;
  timestamp?: Date;
}

export interface RoutingEvaluation {
  matched: boolean;
  rule: { id: string; name: string; route: string } | null;
  route: string | null;
}

function validateConditions(conditions: RoutingConditionInput[]): void {
  if (conditions.length === 0) {
    throw new ValidationError("A routing rule requires at least one condition");
  }
  for (const condition of conditions) {
    if (!VALID_TYPES.includes(condition.type)) {
      throw new ValidationError(`Invalid condition type: ${condition.type}`);
    }
    const allowedOperators = VALID_OPERATORS_BY_TYPE[condition.type];
    if (!allowedOperators.includes(condition.operator)) {
      throw new ValidationError(
        `Operator "${condition.operator}" is not valid for condition type "${condition.type}"`,
      );
    }
    if (condition.operator === "between" && !condition.value2) {
      throw new ValidationError("The 'between' operator requires value2");
    }
    if (condition.type === "amount") {
      try {
        BigInt(condition.value);
        if (condition.value2) BigInt(condition.value2);
      } catch {
        throw new ValidationError("Amount condition values must be integers (stroops)");
      }
    }
    if (condition.type === "time" && !isValidTimeOfDay(condition.value)) {
      throw new ValidationError("Time condition value must be in HH:MM format");
    }
    if (condition.type === "time" && condition.value2 && !isValidTimeOfDay(condition.value2)) {
      throw new ValidationError("Time condition value2 must be in HH:MM format");
    }
  }
}

function isValidTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function timeOfDayToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function parseList(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

/** Evaluates a single condition against a payment context. */
export function conditionMatches(
  condition: { type: string; operator: string; value: string; value2: string | null },
  context: PaymentRoutingContext,
): boolean {
  switch (condition.type) {
    case "amount": {
      const amount = BigInt(context.amount);
      const threshold = BigInt(condition.value);
      if (condition.operator === "gte") return amount >= threshold;
      if (condition.operator === "lte") return amount <= threshold;
      if (condition.operator === "between") {
        return amount >= threshold && amount <= BigInt(condition.value2 ?? condition.value);
      }
      return false;
    }
    case "asset": {
      if (condition.operator === "equals") return context.tokenAddress === condition.value;
      if (condition.operator === "in") return parseList(condition.value).includes(context.tokenAddress);
      return false;
    }
    case "geography": {
      const region = context.region ?? "";
      if (condition.operator === "equals") return region === condition.value;
      if (condition.operator === "in") return parseList(condition.value).includes(region);
      return false;
    }
    case "time": {
      if (condition.operator !== "between") return false;
      const timestamp = context.timestamp ?? new Date();
      const current = timestamp.getUTCHours() * 60 + timestamp.getUTCMinutes();
      const start = timeOfDayToMinutes(condition.value);
      const end = timeOfDayToMinutes(condition.value2 ?? condition.value);
      // Handles windows that wrap past midnight (e.g. 22:00 -> 06:00)
      if (start <= end) return current >= start && current <= end;
      return current >= start || current <= end;
    }
    default:
      return false;
  }
}

export class PaymentRoutingService {
  // ── Rule CRUD ─────────────────────────────────────────────────────────────

  async createRule(input: CreateRoutingRuleInput) {
    validateConditions(input.conditions);

    const existing = await prisma.paymentRoutingRule.findFirst({
      where: { ownerAddress: input.ownerAddress, name: input.name },
    });
    if (existing) {
      throw new ConflictError(`Routing rule "${input.name}" already exists for this address`);
    }

    return prisma.paymentRoutingRule.create({
      data: {
        ownerAddress: input.ownerAddress,
        name: input.name,
        description: input.description,
        route: input.route,
        priority: input.priority ?? 0,
        isActive: input.isActive ?? true,
        conditions: { create: input.conditions },
      },
      include: { conditions: true },
    });
  }

  async getRules(ownerAddress: string) {
    return prisma.paymentRoutingRule.findMany({
      where: { ownerAddress },
      include: { conditions: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  }

  async getRule(id: string, ownerAddress: string) {
    const rule = await prisma.paymentRoutingRule.findFirst({
      where: { id, ownerAddress },
      include: { conditions: true },
    });
    if (!rule) throw new NotFoundError("Routing rule", id);
    return rule;
  }

  async updateRule(id: string, ownerAddress: string, input: UpdateRoutingRuleInput) {
    await this.getRule(id, ownerAddress); // ownership + existence check

    if (input.name) {
      const conflict = await prisma.paymentRoutingRule.findFirst({
        where: { ownerAddress, name: input.name, NOT: { id } },
      });
      if (conflict) throw new ConflictError(`Routing rule "${input.name}" already exists`);
    }

    if (input.conditions) {
      validateConditions(input.conditions);
    }

    return prisma.paymentRoutingRule.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        route: input.route,
        priority: input.priority,
        isActive: input.isActive,
        ...(input.conditions
          ? { conditions: { deleteMany: {}, create: input.conditions } }
          : {}),
      },
      include: { conditions: true },
    });
  }

  async deleteRule(id: string, ownerAddress: string) {
    await this.getRule(id, ownerAddress); // ownership + existence check
    await prisma.paymentRoutingRule.delete({ where: { id } });
  }

  // ── Rule engine ───────────────────────────────────────────────────────────

  /** Evaluates all active rules for an owner (priority order) and returns the first full match. */
  async evaluate(ownerAddress: string, context: PaymentRoutingContext): Promise<RoutingEvaluation> {
    const rules = await prisma.paymentRoutingRule.findMany({
      where: { ownerAddress, isActive: true },
      include: { conditions: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });

    for (const rule of rules) {
      if (rule.conditions.every((condition) => conditionMatches(condition, context))) {
        return {
          matched: true,
          rule: { id: rule.id, name: rule.name, route: rule.route },
          route: rule.route,
        };
      }
    }
    return { matched: false, rule: null, route: null };
  }

  /** Tests a single rule (active or not) against a context, without applying it. */
  async testRule(
    ruleId: string,
    ownerAddress: string,
    context: PaymentRoutingContext,
  ): Promise<{ matched: boolean; matchedConditions: boolean[] }> {
    const rule = await this.getRule(ruleId, ownerAddress);
    const matchedConditions = rule.conditions.map((condition) => conditionMatches(condition, context));
    return { matched: matchedConditions.every(Boolean), matchedConditions };
  }
}
