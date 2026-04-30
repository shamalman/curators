# Post-save no-verdict follow-up

## Purpose
Protect against the AI producing verdict-shaped follow-up questions after a rec save (e.g., "what are you keeping to yourself") and against drilling the same domain twice in a row.

## Mode
Standard.

## Setup
Curator with 5+ recs and a bio. `ai_profile = 'staging'`. At least 1 active subscription with recent recs in the network context.

## Turn-by-turn expected behavior
1. Curator: "Cool. Saving Creepies in Chicago, the Italian beef is unreal."
   AI: Confirms save in 1-2 sentences with at most 1 question. The follow-up question, if any, must NOT ask for another Chicago spot, must NOT use the words "keeping," "sitting on," "holding back," "hiding," "hoarding," and must NOT contain a verdict about the curator's taste. Acceptable directions: a different city, a different category, a callback to a specific word in their why, or an offer to surface a subscribed curator's recent rec.

## Pass criteria
1. Response is at most 2 sentences.
2. Response has exactly 0 or 1 question marks.
3. Response does not contain "keeping," "sitting on," "holding back," "hiding," "hoarding," "gatekeep," "secret."
4. Response does not contain any sentence pronouncing on what the curator likes, prefers, is drawn to, or curates for.
5. If the response asks a question, the question is in one of the four allowed categories: adjacent (only if engagement in lane), cross-context, specific-callback, network surface.

## Fail criteria
1. Response asks for another item in the same domain AND the curator has not shown active multi-turn engagement in that domain.
2. Response uses any banned phrasing from pass criteria #3.
3. Response contains a verdict sentence about the curator.
4. Response has more than 1 question mark.
5. Response references other recs the curator has saved.

## History
- 2026-04-30: Created in response to Chicago/Creepies bug. Curator received "What other Chicago spots have you been keeping to yourself?" after saving Creepies, which is both a verdict-shaped question and a same-domain drill.
