const { loadSkill } = require('./loader');

const SUBSCRIPTION_GROUNDING_RULE = `\n\nGROUNDING RULE FOR SUBSCRIPTIONS: The SUBSCRIBED RECOMMENDATIONS block above is the ground truth for who this curator subscribes to. If it lists curators and recs, reference them by name. If it says the curator doesn't subscribe to anyone, say so. NEVER invent, guess, or deny subscription state that contradicts what's written there. If you cannot find the answer in that block, say 'I don't see any recs from your subscriptions on that topic' rather than claiming the curator isn't subscribed to anyone. When you reference a rec that has a [REC_LINK: <path>] tag next to it, render the rec title as a markdown link using that exact path. Example: if the context shows 'Little Seed by Twisted Teens [REC_LINK: /shamal/little-seed-by-twisted-teens]', write it in your reply as [Little Seed by Twisted Teens](/shamal/little-seed-by-twisted-teens). Never strip, rewrite, or invent rec paths — use only paths that appear in REC_LINK tags.`;

export function buildStandardPrompt({ curatorName, curatorHandle, curatorProfile, networkContext, tasteProfileBlock, aiProfile = 'stable' }) {
  const skills = [
    ...(aiProfile === 'staging' ? [loadSkill('charter', aiProfile)] : []),
    loadSkill('vocabulary', aiProfile),
    loadSkill('no-hallucinations', aiProfile),
    loadSkill('base-personality', aiProfile),
    loadSkill('link-handling', aiProfile),
    loadSkill('image-handling', aiProfile),
    loadSkill('rec-capture', aiProfile),
    loadSkill('taste-reflection', aiProfile),
    loadSkill('agent-handling', aiProfile),
    loadSkill('network-recs', aiProfile),
    loadSkill('feedback-handling', aiProfile),
    loadSkill('trust-building', aiProfile),
    loadSkill('standard-approach', aiProfile),
    loadSkill('curator-stats', aiProfile),
  ].join('\n\n');

  const profileBlock = `WHAT YOU KNOW:\nProfile: ${curatorName} (@${curatorHandle})${curatorProfile.bio ? ` — ${curatorProfile.bio}` : ''}${curatorProfile.location ? ` | ${curatorProfile.location}` : ''}`;

  return `You are the personal AI for ${curatorName} on Curators. You know their taste. Your job is to capture new recommendations, answer questions about their timeline, help them explore the network, and deepen your understanding of their style.\n\n${skills}\n\n${profileBlock}${tasteProfileBlock || ''}\n\n${networkContext || ''}${SUBSCRIPTION_GROUNDING_RULE}`;
}