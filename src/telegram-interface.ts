import TelegramBot from "node-telegram-bot-api";
import { HumanMessage } from "@langchain/core/messages";

interface TelegramInterfaceOptions {
  onExit: () => void;
  onKill: () => void;
}

export class TelegramInterface {
  private bot: TelegramBot;
  private agent: any;
  private config: any;
  private options: TelegramInterfaceOptions;
  private isStarted: boolean = false;

  constructor(agent: any, config: any, options: TelegramInterfaceOptions) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN must be provided!");
    }

    this.bot = new TelegramBot(token, { polling: true });
    this.agent = agent;
    this.config = config;
    this.options = options;

    this.setupHandlers();
    console.log("Telegram bot initialized. Waiting for /start command...");
  }

  private setupHandlers() {
    // Handle /start command
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      this.isStarted = true;
      console.log(
        `Telegram session started by user ${msg.from?.username || msg.from?.id}`,
      );
      this.bot.sendMessage(
        chatId,
        "Hello! I am your NIL blockchain assistant. How can I help you today?\nUse /exit to return to terminal or /kill to shut down the application.",
      );
    });

    // Handle /exit command
    this.bot.onText(/\/exit/, async (msg) => {
      const chatId = msg.chat.id;
      if (this.isStarted) {
        await this.bot.sendMessage(chatId, "Goodbye! Returning to terminal...");
        console.log("Telegram session ended. Returning to terminal...");
        this.bot.stopPolling();
        this.options.onExit();
      }
    });

    // Handle /kill command
    this.bot.onText(/\/kill/, async (msg) => {
      const chatId = msg.chat.id;
      if (this.isStarted) {
        await this.bot.sendMessage(chatId, "Shutting down the application...");
        console.log("Kill command received. Shutting down...");
        this.bot.stopPolling();
        this.options.onKill();
      }
    });

    // Handle /demo command
    this.bot.onText(/\/demo/, (msg) => this.handleDemoCommand(msg));

    // Handle all other messages
    this.bot.on("message", async (msg) => {
      if (msg.text && !msg.text.startsWith("/") && this.isStarted) {
        this.handleMessage(msg);
      }
    });
  }

  private async handleMessage(msg: TelegramBot.Message) {
    if (!msg.text) return;
    
    const chatId = msg.chat.id;
    
    try {
      this.bot.sendChatAction(chatId, 'typing');
      
      // Use invoke instead of stream
      const response = await this.agent.invoke(msg.text, this.config);
      
      // Send the response directly since we're not streaming
      await this.bot.sendMessage(chatId, response);
    } catch (error) {
      console.error("Error processing message:", error);
      await this.bot.sendMessage(
        chatId,
        "I encountered an error processing your request. Please try again."
      );
    }
  }

  private async handleDemoCommand(msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const demoSteps = [
      {
        action: "deploy nil contract COUNTER on shard 1",
        description: "First, let's deploy a Counter contract on shard 1"
      },
      {
        action: "What features does the COUNTER contract have?",
        description: "Let's learn about the deployed contract's features"
      }
    ];

    await this.bot.sendMessage(chatId, "Starting Demo Mode...\n" +
      "This demo will showcase NIL blockchain contract deployment");

    for (const step of demoSteps) {
      await this.bot.sendMessage(chatId, `\nDemo Step: ${step.description}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await this.bot.sendMessage(chatId, `Executing: ${step.action}`);
      
      try {
        const response = await this.agent.invoke(step.action);
        await this.bot.sendMessage(chatId, response);
      } catch (error) {
        await this.bot.sendMessage(chatId, `Error in demo step: ${error}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    await this.bot.sendMessage(chatId, "\nDemo completed! You can now try these actions yourself.");
  }
}
