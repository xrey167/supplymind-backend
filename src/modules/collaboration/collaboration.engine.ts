import { nanoid } from 'nanoid';
import type {
  AgentResponse,
  CollabDispatchFn,
  CollaborationRequest,
  CollaborationResult,
} from './collaboration.types';

async function queryAgents(
  agents: string[],
  query: string,
  dispatch: CollabDispatchFn,
  timeoutMs = 30_000,
): Promise<AgentResponse[]> {
  return Promise.all(
    agents.map(async (agent) => {
      const start = Date.now();
      try {
        const result = await Promise.race([
          dispatch(agent, { query }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeoutMs),
          ),
        ]);
        return { agent, result, durationMs: Date.now() - start };
      } catch (err) {
        return {
          agent,
          result: '',
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

function computeSimilarity(a: string, b: string): number {
  const toWords = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4),
    );
  const setA = toWords(a);
  const setB = toWords(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / new Set([...setA, ...setB]).size;
}

function averagePairwiseSimilarity(responses: string[]): number {
  if (responses.length < 2) return 1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < responses.length; i++) {
    for (let j = i + 1; j < responses.length; j++) {
      sum += computeSimilarity(responses[i], responses[j]);
      count++;
    }
  }
  return count === 0 ? 1 : sum / count;
}

async function fanOut(
  req: CollaborationRequest,
  dispatch: CollabDispatchFn,
): Promise<CollaborationResult> {
  const start = Date.now();
  const responses = await queryAgents(req.agents, req.query, dispatch, req.timeoutMs);
  const successResponses = responses.filter((r) => !r.error);
  const output = successResponses.map((r) => `[${r.agent}]: ${r.result}`).join('\n\n');
  return {
    id: nanoid(),
    strategy: 'fan_out',
    output,
    responses,
    totalDurationMs: Date.now() - start,
  };
}

async function consensus(
  req: CollaborationRequest,
  dispatch: CollabDispatchFn,
): Promise<CollaborationResult> {
  const start = Date.now();
  const responses = await queryAgents(req.agents, req.query, dispatch, req.timeoutMs);
  const successResponses = responses.filter((r) => !r.error);

  if (successResponses.length === 0) {
    return {
      id: nanoid(),
      strategy: 'consensus',
      output: '',
      responses,
      totalDurationMs: Date.now() - start,
      warning: 'All agents failed',
    };
  }

  const judge = req.judgeAgent ?? req.agents[0];
  const judgePrompt = [
    'Score each response 1-10 and pick the best. Return JSON: { "scores": [{ "id": <index>, "score": <1-10>, "reason": "..." }], "bestId": <index>, "agreement": <0-1> }',
    '',
    ...successResponses.map((r, i) => `Response ${i}: ${r.result}`),
  ].join('\n');

  let bestIdx = 0;
  let agreement: number | undefined;

  try {
    const judgeResult = await dispatch(judge, { query: judgePrompt });
    const parsed = JSON.parse(judgeResult);
    bestIdx = typeof parsed.bestId === 'number' ? parsed.bestId : 0;
    agreement = typeof parsed.agreement === 'number' ? parsed.agreement : undefined;
    if (Array.isArray(parsed.scores)) {
      for (const s of parsed.scores) {
        if (typeof s.id === 'number' && successResponses[s.id]) {
          successResponses[s.id].score = s.score;
        }
      }
    }
  } catch {
    // fallback: pick first
    bestIdx = 0;
  }

  const best = successResponses[bestIdx] ?? successResponses[0];

  return {
    id: nanoid(),
    strategy: 'consensus',
    output: best.result,
    responses,
    agreement,
    totalDurationMs: Date.now() - start,
  };
}

async function debate(
  req: CollaborationRequest,
  dispatch: CollabDispatchFn,
): Promise<CollaborationResult> {
  const start = Date.now();
  const maxRounds = req.maxRounds ?? 2;
  const threshold = req.convergenceThreshold ?? 0.85;
  const allResponses: AgentResponse[] = [];
  let previousResults: string[] = [];
  let round = 0;
  let convergedAt: number | undefined;

  for (let r = 1; r <= maxRounds; r++) {
    round = r;
    const context =
      previousResults.length > 0
        ? `Previous responses:\n${previousResults.map((r, i) => `[${i}]: ${r}`).join('\n')}\n\nNow refine your answer:\n${req.query}`
        : req.query;

    const responses = await queryAgents(req.agents, context, dispatch, req.timeoutMs);
    for (const r of responses) r.round = round;
    allResponses.push(...responses);

    const currentResults = responses.filter((r) => !r.error).map((r) => r.result);
    if (currentResults.length >= 2) {
      const sim = averagePairwiseSimilarity(currentResults);
      if (sim >= threshold) {
        convergedAt = round;
        break;
      }
    }
    previousResults = currentResults;
  }

  const lastRoundResponses = allResponses.filter((r) => r.round === round && !r.error);
  const output = lastRoundResponses.map((r) => `[${r.agent}]: ${r.result}`).join('\n\n');

  return {
    id: nanoid(),
    strategy: 'debate',
    output,
    responses: allResponses,
    rounds: round,
    convergedAt,
    totalDurationMs: Date.now() - start,
  };
}

async function mapReduce(
  req: CollaborationRequest,
  dispatch: CollabDispatchFn,
): Promise<CollaborationResult> {
  const start = Date.now();
  const items = req.items ?? [];
  const agents = req.agents;

  // Distribute items round-robin
  const responses: AgentResponse[] = await Promise.all(
    items.map(async (item, idx) => {
      const agent = agents[idx % agents.length];
      const agentStart = Date.now();
      try {
        const result = await dispatch(agent, { query: req.query, item });
        return { agent, result, durationMs: Date.now() - agentStart };
      } catch (err) {
        return {
          agent,
          result: '',
          durationMs: Date.now() - agentStart,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const output = responses
    .filter((r) => !r.error)
    .map((r) => r.result)
    .join('\n');

  return {
    id: nanoid(),
    strategy: 'map_reduce',
    output,
    responses,
    totalDurationMs: Date.now() - start,
  };
}

export async function collaborate(
  req: CollaborationRequest,
  dispatch: CollabDispatchFn,
): Promise<CollaborationResult> {
  switch (req.strategy) {
    case 'fan_out':
      return fanOut(req, dispatch);
    case 'consensus':
      return consensus(req, dispatch);
    case 'debate':
      return debate(req, dispatch);
    case 'map_reduce':
      return mapReduce(req, dispatch);
    default:
      throw new Error(`Unknown strategy: ${req.strategy}`);
  }
}
