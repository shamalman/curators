'use client'

import FeedTextBlock from "./FeedTextBlock";
import FeedMediaEmbed from "./FeedMediaEmbed";
import FeedActionButtons from "./FeedActionButtons";
import FeedTasteRead from "./FeedTasteRead";
import FeedAgentBanner from "./FeedAgentBanner";
import TasteReadCard from "../taste-read/TasteReadCard";

export default function FeedBlockGroup({ blocks, interactions, messageId, tappedActions, onSendMessage, onInteraction }) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div style={{ padding: "4px 0", display: "flex", flexDirection: "column" }}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return <FeedTextBlock key={i} data={block.data} />;
          case 'media_embed':
            return <FeedMediaEmbed key={i} data={block.data} />;
          case 'taste_read':
            return <FeedTasteRead key={i} data={block.data} />;
          case 'taste_read_card':
            return <TasteReadCard key={i} data={block.data} onSendMessage={onSendMessage} />;
          case 'action_buttons': {
            const interactionActions = (interactions || [])
              .filter(x => x.block_index === i)
              .map(x => x.action);
            const usedActions = new Set([...interactionActions, ...(tappedActions || [])]);
            return (
              <FeedActionButtons
                key={i}
                data={block.data}
                usedActions={usedActions}
                onUse={(option) => {
                  if (onInteraction) onInteraction(messageId, i, option.action);
                  if (onSendMessage) onSendMessage(option.action);
                }}
              />
            );
          }
          case 'agent_banner': {
            const isUsed = (interactions || []).some(x => x.block_index === i);
            return (
              <FeedAgentBanner
                key={i}
                data={block.data}
                used={isUsed}
                onAction={(bannerData) => {
                  if (onInteraction) onInteraction(messageId, i, 'banner_clicked');
                  if (onSendMessage) onSendMessage(`Show me what you found from my ${bannerData.source_name || bannerData.sourceName || 'source'}`);
                }}
              />
            );
          }
          case 'rec_capture':
            // Rendered by ChatView save card area, not as a feed block
            return null;
          default:
            return null;
        }
      })}
    </div>
  );
}
