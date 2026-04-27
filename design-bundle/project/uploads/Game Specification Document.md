# **Game Designer's Specification: CYOA Web Engine**

## **1\. Vision Statement**

The goal is to provide a seamless, high-immersion reading experience where player agency is quantified through meaningful consequences, resource management, and narrative branching. The interface should feel like a "living book."

## **2\. Core Functional Requirements**

### **A. Narrative Branching & Logic**

* **Scene Transitions**: Every scene (node) must lead to at least one choice or a "Game Over/The End" state.  
* **Conditional Visibility**: Choices should be context-aware. If a player lacks a specific item (e.g., "Rusty Key") or a stat is too low (e.g., "Strength \< 5"), the designer can choose to either hide the option entirely or show it as a "locked" (unclickable) button to tease future possibilities.  
* **Global Flags**: The system must track invisible "story tags" (e.g., met\_queen, betrayed\_thieves). These tags allow the designer to change the narrative text in later scenes based on earlier actions.

### **B. Player Attribute System**

The designer can define and manipulate the following resources:

* **Vitality (Health)**: A numeric value. Reaching zero triggers an immediate jump to a designated "Death" scene.  
* **Currency (Gold)**: A numeric value used for commerce-based choices.  
* **Inventory**: A list of unique items. Items can be used as "keys" to unlock specific narrative branches.  
* **Hidden Stats**: Values like "Morality" or "Infamy" that aren't shown to the player but affect how NPCs react in the story.

### **C. Scene-Level Effects**

* **Auto-Modifiers**: The designer can set effects that happen just by entering a room (e.g., entering a "Poisoned Room" immediately subtracts 5 Health).  
* **Delayed Consequences**: The ability to set a flag that triggers a specific event three nodes later.

## **3\. Player Experience & Modes**

### **Story Mode (The Explorer)**

* **Safety Net**: Includes an "Undo" or "Rewind" feature allowing the player to back up one step and try a different path.  
* **Bookmarks**: Players can save their progress and return later.

### **Hardcore Mode (The Survivor)**

* **High Stakes**: No rewinding. Every choice is final.  
* **Permadeath**: If the player dies, the save file is purged. The designer should use this mode to reward careful resource management.

## **4\. Visual & UI Requirements (UX)**

* **Atmospheric Themes**: Support for "Day," "Night," and "Sepia" (parchment) themes to match the story's mood.  
* **Dynamic Feedback**: When a stat changes (e.g., \+10 Gold), a brief visual indicator or animation should notify the player.  
* **Typography Controls**: Since this is a text-heavy game, players must be able to toggle between Sans-Serif (modern) and Serif (classic) fonts and adjust text size for comfort.  
* **Media Integration**: Support for full-width background images or ambient sound loops for specific key scenes.

## **5\. Content Structure (Design Workflow)**

* **Modular Storytelling**: The story should be written in discrete "Nodes."  
* **Reusable Logic**: Designers should be able to point multiple choices from different scenes back to a single "Common Result" node to manage complexity.  
* **Ending Tracking**: A system to track which unique endings the player has unlocked across multiple playthroughs.

## **6\. Success Criteria for Design**

* **Agency**: No more than three "flavor" choices (choices with no mechanical impact) in a row.  
* **Flow**: Navigating between the story and the inventory should feel instantaneous.  
* **Consistency**: Stat changes must be reflected immediately in the UI to maintain the "game" feel.