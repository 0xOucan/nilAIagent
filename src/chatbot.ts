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

// Add these types
type Agent = {
  invoke: (input: string, config?: AgentConfig) => Promise<string>;
  walletProvider: WalletProvider;
  actionProviders: ActionProvider<WalletProvider>[];
  getActions: () => any[];
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
        getActions: () => tools
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
  const requiredVars = ["OPENAI_API_KEY", "NIL_RPC_ENDPOINT", "NIL_FAUCET_ENDPOINT"];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
  }
  
  // We don't need to check for CDP credentials since we're using NIL APIs directly
  console.log("Environment validated successfully - Note: No Coinbase CDP credentials required");
}

// Interactive chat mode
function startChatMode(agent: Agent, config: AgentConfig, rl: readline.Interface) {
  console.log("Starting chat mode... Type 'exit' to end.");
  
  const promptUser = () => {
    rl.question("Prompt: ", async (input) => {
      if (input.toLowerCase() === "exit") {
        rl.close();
        process.exit(0);
        return;
      }
      
      try {
        const response = await agent.invoke(input, config);
        console.log(response);
      } catch (error) {
        console.error("Error processing message:", error);
      }
      
      promptUser();
    });
  };
  
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
