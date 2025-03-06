import dotenv from "dotenv";
dotenv.config();

import readline from "readline";
import {
  AgentKit,
  ActionProvider,
  Network,
  ViemWalletProvider as WalletProvider,
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import "reflect-metadata";
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains'; // We'll use this just for the mock

// Import action providers
import { nilContractActionProvider } from "./action-providers/nil-contract/nilContractActionProvider";
import { nilAccountActionProvider } from "./action-providers/nil-account/nilAccountActionProvider";
import { nilBalanceActionProvider } from "./action-providers/nil-account/nilBalanceActionProvider";
import { TelegramInterface } from "./telegram-interface";
import { nilSmartAccountActionProvider } from "./action-providers/nil-account/nilSmartAccountActionProvider";
import { nilSupplyChainActionProvider } from "./action-providers/nil-supply-chain";

// Add these types
type Agent = {
  invoke: (input: string, config?: AgentConfig) => Promise<string>;
  walletProvider: WalletProvider;
  actionProviders: ActionProvider<WalletProvider>[];
  getActions: () => any[];
  findProviderByActionName?: (name: string) => ActionProvider<WalletProvider> | undefined;
};

type AgentConfig = {
  configurable: { thread_id: string };
};

// Initialize environment
(async () => {
  try {
    validateEnvironment();
    console.log("Environment validated successfully");
  } catch (error) {
    console.error("Environment validation failed:", error);
    process.exit(1);
  }

  console.log("Starting initialization...");
  
  try {
    const { agent, config } = await initializeAgent();
    console.log("Agent initialized successfully");

    // Display available modes
    console.log("\nAvailable modes:");
    console.log("1. chat      - Interactive chat mode");
    console.log("2. telegram  - Telegram bot mode");
    console.log("3. auto      - Autonomous action mode");
    console.log("4. demo      - Demo mode with preset actions");

    // Set up readline interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("\nChoose a mode (enter number or name): ", async (answer) => {
      const mode = answer.trim().toLowerCase();
      
      if (mode === "1" || mode === "chat") {
        console.log("Selected mode: chat");
        startChatMode(agent, config, rl);
      } 
      else if (mode === "2" || mode === "telegram") {
        console.log("Selected mode: telegram");
        startTelegramMode(agent, config, rl);
      }
      else if (mode === "3" || mode === "auto") {
        console.log("Selected mode: auto");
        startAutoMode(agent, config, rl);
      }
      else if (mode === "4" || mode === "demo") {
        console.log("Selected mode: demo");
        startDemoMode(agent, config, rl);
      }
      else {
        console.log("Invalid mode. Defaulting to chat mode.");
        startChatMode(agent, config, rl);
      }
    });
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    process.exit(1);
  }
})();

// Initialize the agent with AgentKit
async function initializeAgent(): Promise<{ agent: Agent; config: AgentConfig }> {
  try {
    console.log("Initializing agent...");

    // Create a mock wallet provider to satisfy AgentKit requirements
    // This is ONLY for compatibility with AgentKit - it's not used for NIL operations
    const mockPrivateKey = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const mockAccount = privateKeyToAccount(mockPrivateKey);
    
    const mockClient = createWalletClient({
      account: mockAccount,
      chain: mainnet, // Using mainnet just for the mock
      transport: http(),
    });
    
    // Create a mock wallet provider - we don't need CDP credentials since we use NIL's native APIs
    const mockWalletProvider = new WalletProvider(mockClient);
    console.log("Created mock wallet provider (ONLY for AgentKit compatibility - not used for NIL operations)");

    // Initialize LLM
    const llm = new ChatOpenAI({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.1,
    });

    console.log("LLM initialized");

    // Initialize AgentKit with NIL action providers
    const providers = [
      nilAccountActionProvider(),
      nilContractActionProvider(),
      nilBalanceActionProvider(),
      nilSmartAccountActionProvider(),
      nilSupplyChainActionProvider(),
    ];

    // Now provide the mock wallet provider
    const agentkit = await AgentKit.from({
      walletProvider: mockWalletProvider,
      actionProviders: providers,
    });

    const tools = await getLangChainTools(agentkit);
    const memory = new MemorySaver();
    const agentConfig = {
      configurable: { thread_id: "NIL-Blockchain-Chatbot" }
    };

    const reactAgent = await createReactAgent({
      llm,
      tools,
      checkpointSaver: memory,
      messageModifier: `
        You are a helpful agent that can interact with the NIL blockchain using the provided tools.
        You are empowered to deploy and interact with smart contracts on NIL.
        
        Available Features:
        - Deploy smart contracts to NIL blockchain shards
        - Interact with deployed contracts
        - Get account information
        - View contract deployment status
        
        Smart Contract Features:
        - Deploy Counter contract to any shard
        - Get contract details and verification status
        - View contract explorer links
        
        Always provide clickable explorer links when returning contract addresses or transaction hashes.
        
        IMPORTANT COMMAND HANDLING:
        - When a user says "deploy smart account" or similar, immediately execute the create-smart-account action with default parameters.
        - If user specifies a shard (e.g., "deploy smart account shard 2"), use that shard but keep all other parameters default.
        - Always use random salt values and auto-generate private keys when not explicitly provided.
        - Avoid asking for further input when defaults can be used - take initiative to complete the action.
        - Focus on making interactions simple and direct, with minimal back-and-forth.
      `,
    });

    return { 
      agent: {
        invoke: async (input: string, config?: AgentConfig) => {
          const result = await reactAgent.invoke(
            { messages: [new HumanMessage(input)] },
            config || agentConfig
          );
          return result.messages[result.messages.length - 1].content as string;
        },
        walletProvider: mockWalletProvider, 
        actionProviders: providers,
        getActions: () => tools,
        findProviderByActionName: (name: string) => {
          return providers.find(p => 
            p.getActions(mockWalletProvider).some(a => a.name === name)
          );
        }
      },
      config: agentConfig 
    };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

// Validate required environment variables
function validateEnvironment() {
  const requiredVars = [
    'OPENAI_API_KEY',
    'NIL_RPC_ENDPOINT',
    'NIL_FAUCET_ENDPOINT'
  ];
  
  const missingVars = requiredVars.filter(variable => !process.env[variable]);
  
  if (missingVars.length > 0) {
    console.error('\nEnvironment Error: The following required environment variables are missing:');
    missingVars.forEach(variable => {
      console.error(`- ${variable}`);
    });
    console.error('\nPlease create a .env file with these variables. See .env.example for reference.');
    process.exit(1);
  }
  
  // Optional but recommended: validate URL formats for endpoints
  try {
    new URL(process.env.NIL_RPC_ENDPOINT!);
    new URL(process.env.NIL_FAUCET_ENDPOINT!);
  } catch (error) {
    console.error('\nEnvironment Error: Invalid URL format for NIL_RPC_ENDPOINT or NIL_FAUCET_ENDPOINT');
    console.error('Please make sure these are valid URLs in your .env file.');
    process.exit(1);
  }
  
  console.log('Environment validation successful.');
}

// Interactive chat mode
function startChatMode(agent: Agent, config: AgentConfig, rl: readline.Interface) {
  console.log("Starting chat mode... Type 'exit' to end.");

  const displayMenu = () => {
    const menu = generateCommandMenu(agent);
    console.log(menu);
  };

  const promptUser = () => {
    rl.question("Prompt: ", async (input) => {
      if (input.toLowerCase() === "exit") {
        console.log("Exiting chat mode...");
        process.exit(0);
      } else if (input.toLowerCase() === "/menu" || input.toLowerCase() === "menu") {
        displayMenu();
        promptUser();
      } else {
        try {
          const response = await agent.invoke(input, config);
          console.log(response);
        } catch (error) {
          console.error("Error processing message:", error);
        }
        promptUser();
      }
    });
  };
  
  // Show menu on startup
  displayMenu();
  promptUser();
}

// Telegram bot mode
function startTelegramMode(agent: Agent, config: AgentConfig, rl: readline.Interface) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN not set. Cannot start Telegram mode.");
    rl.close();
    process.exit(1);
    return;
  }
  
  try {
    const telegramInterface = new TelegramInterface(agent, config, {
      onExit: () => {
        console.log("Telegram session ended. Choose another mode:");
        rl.question("\nChoose a mode (enter number or name): ", (answer) => {
          const mode = answer.trim().toLowerCase();
          if (mode === "1" || mode === "chat") startChatMode(agent, config, rl);
          else if (mode === "3" || mode === "auto") startAutoMode(agent, config, rl);
          else if (mode === "4" || mode === "demo") startDemoMode(agent, config, rl);
          else {
            console.log("Invalid mode. Defaulting to chat mode.");
            startChatMode(agent, config, rl);
          }
        });
      },
      onKill: () => {
        console.log("Shutting down application...");
        rl.close();
        process.exit(0);
      }
    });
  } catch (error) {
    console.error("Error initializing Telegram interface:", error);
    rl.close();
    process.exit(1);
  }
}

// Autonomous mode
function startAutoMode(agent: Agent, config: AgentConfig, rl: readline.Interface) {
  console.log("Auto mode is not fully implemented yet.");
  rl.close();
  process.exit(0);
}

// Demo mode with predefined actions
function startDemoMode(agent: Agent, config: AgentConfig, rl: readline.Interface) {
  console.log("Starting demo mode...");
  console.log("Note: Smart account creation may fail if the NIL faucet service is unavailable.");
  
  const demoSteps = [
    {
      description: "Checking address balance on shard 1",
      prompt: "check nil balance 0x0001d849f44e13afef2128cf3170e21b341af2d6 on shard 1"
    },
    {
      description: "Deploying a Counter contract on shard 1",
      prompt: "deploy nil contract COUNTER on shard 1"
    },
    {
      description: "Checking contract deployment status",
      prompt: "What can I do with the deployed contract?"
    }
  ];
  
  let currentStep = 0;
  
  const runNextStep = async () => {
    if (currentStep >= demoSteps.length) {
      console.log("\nDemo completed! Returning to mode selection.");
      rl.question("\nChoose a mode (enter number or name): ", (answer) => {
        const mode = answer.trim().toLowerCase();
        if (mode === "1" || mode === "chat") startChatMode(agent, config, rl);
        else if (mode === "2" || mode === "telegram") startTelegramMode(agent, config, rl);
        else if (mode === "3" || mode === "auto") startAutoMode(agent, config, rl);
        else {
          console.log("Invalid mode. Defaulting to chat mode.");
          startChatMode(agent, config, rl);
        }
      });
      return;
    }
    
    const step = demoSteps[currentStep];
    console.log(`\nDemo Step ${currentStep + 1}: ${step.description}`);
    console.log(`Executing: ${step.prompt}`);
    
    try {
      const response = await agent.invoke(step.prompt, config);
      console.log(response);
      
      currentStep++;
      rl.question("\nPress Enter to continue to the next step...", runNextStep);
    } catch (error) {
      console.error("Error in demo step:", error);
      rl.question("\nPress Enter to retry this step or type 'skip' to move on...", (answer) => {
        if (answer.trim().toLowerCase() === "skip") {
          currentStep++;
        }
        runNextStep();
      });
    }
  };
  
  runNextStep();
}

// Improved function to generate command menu
function generateCommandMenu(agent: Agent): string {
  // Get all available actions
  const actions = agent.getActions();
  
  // Group actions by category
  const categories: Record<string, any[]> = {
    "Contract Deployment": [],
    "Account Management": [],
    "Contract Interaction": [],
    "Balance Operations": [],
    "Supply Chain": [],
    "Other": []
  };
  
  // Map actions to categories with examples
  actions.forEach(action => {
    const name = action.name;
    const provider = agent.actionProviders.find(p => 
      p.getActions(agent.walletProvider).some(a => a.name === name)
    );
    
    // Try to get example if the provider supports it
    let example = "";
    if (provider && typeof (provider as any).getCommandExample === 'function') {
      example = (provider as any).getCommandExample(name);
    }
    
    const actionInfo = {
      name,
      description: action.description,
      example
    };
    
    if (name.startsWith("deploy-") && !name.includes("smart-account") && !name.includes("supply-chain")) {
      categories["Contract Deployment"].push(actionInfo);
    } else if (name.includes("smart-account") || name.includes("token")) {
      categories["Account Management"].push(actionInfo);
    } else if (name.includes("balance")) {
      categories["Balance Operations"].push(actionInfo);
    } else if (name.includes("supply-chain") || name.includes("product") || name.includes("manufacturer") || name.includes("retailer")) {
      categories["Supply Chain"].push(actionInfo);
    } else if (name.includes("counter") || name.includes("increment") || name.includes("get")) {
      categories["Contract Interaction"].push(actionInfo);
    } else {
      categories["Other"].push(actionInfo);
    }
  });
  
  // Build enhanced menu text with examples
  let menu = "# Available Commands\n\n";
  
  Object.entries(categories).forEach(([category, actionInfos]) => {
    if (actionInfos.length > 0) {
      menu += `## ${category}\n`;
      actionInfos.forEach(info => {
        menu += `- **${info.name}**: ${info.description}\n`;
        if (info.example) {
          menu += `  Example: \`${info.example}\`\n`;
        }
      });
      menu += "\n";
    }
  });
  
  menu += "Use `/menu` to see this list again anytime.\n";
  menu += "Use `/show-examples` to see detailed examples for all commands.\n";
  return menu;
}
