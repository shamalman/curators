const { loadSkill } = require('./loader');

const SUBSCRIPTION_GROUNDING_RULE = `\n\nGROUNDING RULE FOR SUBSCRIPTIONS: The SUBSCRIBED RECOMMENDATIONS block above is the ground truth for who this curator subscribes to. If it lists curators and recs, reference them by name. If it says the curator doesn't subscribe to anyone, say so. NEVER invent, guess, or deny subscription state that contradicts what's written there. If you cannot find the answer in that block, say 'I don't see any recs from your subscriptions on that topic' rather than claiming the curator isn't subscribed to anyone. When you reference a rec that has a [REC_LINK: <path>] tag next to it, render the rec title as a markdown link using that exact path. Example: if the context shows 'Little Seed by Twisted Teens [REC_LINK: /shamal/little-seed-by-twisted-teens]', write it in your reply as [Little Seed by Twisted Teens](/shamal/little-seed-by-twisted-teens). Never strip, rewrite, or invent rec paths — use only paths that appear in REC_LINK tags.`;

export function buildOnboardingPrompt({ curatorName, inviterName, inviterHandle, inviterNote, tasteProfileBlock, networkContext, aiProfile = 'stable' }) {
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
    loadSkill('feedback-handling', aiProfile),
    loadSkill('trust-building', aiProfile),
    loadSkill('onboarding-approach', aiProfile),
  ].join('\n\n');

  let curatorContext = `\nCURATOR NAME: ${curatorName || 'Unknown'}`;

  if (inviterName) {
    curatorContext += `\nINVITER NAME: ${inviterName}`;
    curatorContext += `\nINVITER HANDLE: @${inviterHandle || 'unknown'}`;
    curatorContext += `\nINVITER NOTE: ${inviterNote ? inviterNote : '(none)'}`;
  }

  return `You are the personal AI for a new curator on Curators. Your job is to learn their taste and capture their recommendations through natural conversation.\n\n${skills}\n\n${curatorContext}${tasteProfileBlock || ''}\n\n${networkContext || ''}${SUBSCRIPTION_GROUNDING_RULE}`;
}
