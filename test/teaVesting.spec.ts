import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
	TeaVesting,
	TestERC20,
	TestERC20__factory,
	TeaVesting__factory,
} from '../typechain-types';
import { ethers, config } from 'hardhat';
import { expect } from 'chai';
import {
  BigNumberish,
} from 'ethers';
import {
  getCurrentTimestamp,
} from '../utils/getCurrentTimestamp';
import { ecsign } from 'ethereumjs-util';

async function getCurrentBlockTimestamp() {
  const block = await ethers.provider.getBlock('latest');
  return block?.timestamp as number;
}

async function increaseTimestamp(time: BigNumberish) {
	await ethers.provider.send("evm_increaseTime", [time]);
	await ethers.provider.send("evm_mine");
}

describe('TeaVesting', () => {
	let teaVesting: TeaVesting
  let teaToken: TestERC20;
	let presaleTeaTokenA: TestERC20;
	let presaleTeaTokenB: TestERC20;
	let presaleTeaTokenC: TestERC20;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
	let user4: HardhatEthersSigner;
	let ownerVesting: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let accounts: HardhatEthersSigner[];
	let thousand = ethers.parseEther('1000');
	let million = ethers.parseEther('1000000');
	let threeMillion = ethers.parseEther('3000000');
	let ONE_MONTH = 2629800;
	let INITIAL_PERCENT = [100n, 200n, 500n]; // [10%, 20%, 50%];
	let currentTimestamp: BigNumberish;
	let nextMonth: BigNumberish;

	const getSignatureOffChainOwnership = async(
		teaVesting: TeaVesting,
		from: HardhatEthersSigner,
		to: HardhatEthersSigner,
		token: TestERC20,
		signerIndex: number
	) => {
		const accounts = config.networks.hardhat.accounts;
		const wallet = ethers.Wallet.fromPhrase(accounts.mnemonic); // Always using user1 account
		const privateKey = wallet.privateKey;
		const TRANSFER_OWNER_TYPEHASH = 
			'0x33c8deca30830df19b44e9ca8b7b53a5c4dc23e1161fc88d6f7e6954c4f54a9f';
		const nonce = await teaVesting.nonces(from);
		const currentTime = await getCurrentBlockTimestamp();
		const deadline = currentTime + 15 * 60;
		const structHash = ethers.keccak256(
			ethers.AbiCoder.defaultAbiCoder().encode(
				[
					'bytes32',
					'address',
					'address',
					'address',
					'uint256',
					'uint256',
				],
				[
					TRANSFER_OWNER_TYPEHASH,
					await token.getAddress(),
					from.address,
					to.address,
					nonce,
					deadline,
				],
			),
		);
		const digestFromContract = await teaVesting.hashTypedDataV4(structHash);
		const { v, r, s } = ecsign(
			Buffer.from(digestFromContract.slice(2), "hex"),
			Buffer.from(privateKey.slice(2), "hex")
		);

		return {
				token: await token.getAddress(),
				from: from.address,
				to: to.address,
				deadline: '0x' + deadline.toString(16),
				v: BigInt(v),
				r: '0x' + r.toString('hex'),
				s: '0x' + s.toString('hex'),
			};
	}

  it('Setup core contract', async () => {
    [
			user1,
			user2,
			user3,
			user4,
			ownerVesting,
			treasury,
			deployer,
			...accounts
		] = await ethers.getSigners();

		presaleTeaTokenA = await new TestERC20__factory(deployer).deploy(million);
		presaleTeaTokenB = await new TestERC20__factory(deployer).deploy(million);
		presaleTeaTokenC = await new TestERC20__factory(deployer).deploy(million);
		teaToken = await new TestERC20__factory(deployer).deploy(threeMillion);

		currentTimestamp = getCurrentTimestamp() + 100;
		nextMonth = currentTimestamp + ONE_MONTH;
		teaVesting = await new TeaVesting__factory(deployer).deploy(
			'TeaVesting', 																					// _name 
			ownerVesting.address, 																	// _initialOwner
			teaToken, 																							// _tea
			treasury, 																							// _treasury
			deployer, 																							// _trustedForwarder
			[presaleTeaTokenA, presaleTeaTokenB, presaleTeaTokenC], 	// _tokenAddrs
			[currentTimestamp, currentTimestamp, currentTimestamp], // _dataStarts
			[nextMonth, nextMonth, nextMonth], 											// _dataEnds
			INITIAL_PERCENT 																				// _percentUnlocks 10% = 100
		);

		await teaToken.connect(deployer).transfer(treasury, threeMillion);
		await teaToken.connect(treasury).approve(teaVesting, threeMillion);
  });

  it('Check vesting config', async () => {
		const [
			configTokenA,
			configTokenB,
			configTokenC
		] = await Promise.all([
			teaVesting.getVestingTokens(presaleTeaTokenA),
			teaVesting.getVestingTokens(presaleTeaTokenB),
			teaVesting.getVestingTokens(presaleTeaTokenC),
		]);
		expect(configTokenA[0]).to.equal(nextMonth);
		expect(configTokenB[0]).to.equal(nextMonth);
		expect(configTokenC[0]).to.equal(nextMonth);

		expect(configTokenA[1]).to.equal(currentTimestamp);
		expect(configTokenB[1]).to.equal(currentTimestamp);
		expect(configTokenC[1]).to.equal(currentTimestamp);

		expect(configTokenA[2]).to.equal(ONE_MONTH);
		expect(configTokenB[2]).to.equal(ONE_MONTH);
		expect(configTokenC[2]).to.equal(ONE_MONTH);

		expect(configTokenA[3]).to.equal(INITIAL_PERCENT[0]);
		expect(configTokenB[3]).to.equal(INITIAL_PERCENT[1]);
		expect(configTokenC[3]).to.equal(INITIAL_PERCENT[2]);
  });

	it('Transfer presale tokens to users', async()=>{
		await Promise.all([
			presaleTeaTokenA.connect(deployer).transfer(user1, thousand),
			presaleTeaTokenB.connect(deployer).transfer(user2, thousand),
			presaleTeaTokenC.connect(deployer).transfer(user3, thousand),
		]);
		const [
			balanceUser1,
			balanceUser2,
			balanceUser3
		] = await Promise.all([
			presaleTeaTokenA.balanceOf(user1),
			presaleTeaTokenB.balanceOf(user2),
			presaleTeaTokenC.balanceOf(user3),
		]);
		expect(balanceUser1).to.equal(thousand);
		expect(balanceUser2).to.equal(thousand);
		expect(balanceUser3).to.equal(thousand);
	})

	it('Vest token', async()=>{
		await Promise.all([
			presaleTeaTokenA.connect(user1).approve(teaVesting, thousand),
			presaleTeaTokenB.connect(user2).approve(teaVesting, thousand),
			presaleTeaTokenC.connect(user3).approve(teaVesting, thousand),
		]);

		const revertTx = teaVesting.connect(user1).vest(presaleTeaTokenA, thousand);
		await expect(revertTx).to.be.revertedWithCustomError(teaVesting, 'VestingDoesNotStart');

		await increaseTimestamp(100);

		await Promise.all([
			teaVesting.connect(user1).vest(presaleTeaTokenA, thousand),
			teaVesting.connect(user2).vest(presaleTeaTokenB, thousand),
			teaVesting.connect(user3).vest(presaleTeaTokenC, thousand),
		]);
		const [
			vestingDataUser1,
			vestingDataUser2,
			vestingDataUser3
		] = await Promise.all([
			teaVesting.getVestingUsers(user1, presaleTeaTokenA),
			teaVesting.getVestingUsers(user2, presaleTeaTokenB),
			teaVesting.getVestingUsers(user3, presaleTeaTokenC),
		])
		
		const balanceWithoutInitialClaimUser1 = vestingDataUser1[0] - vestingDataUser1[1];
		const balanceWithoutInitialClaimUser2 = vestingDataUser2[0] - vestingDataUser2[1];
		const balanceWithoutInitialClaimUser3 = vestingDataUser3[0] - vestingDataUser3[1];

		const initialClaimUser1 = thousand * INITIAL_PERCENT[0] / 1000n;
		const initialClaimUser2 = thousand * INITIAL_PERCENT[1] / 1000n;
		const initialClaimUser3 = thousand * INITIAL_PERCENT[2] / 1000n;

		const [
			balanceUser1,
			balanceUser2,
			balanceUser3,
		] = await Promise.all([
			teaToken.balanceOf(user1),
			teaToken.balanceOf(user2),
			teaToken.balanceOf(user3),
		]);

		expect(vestingDataUser1[1]).to.equal(balanceUser1 - initialClaimUser1);
		expect(vestingDataUser2[1]).to.equal(balanceUser2 - initialClaimUser2);
		expect(vestingDataUser3[1]).to.equal(balanceUser3 - initialClaimUser3);

		expect(balanceWithoutInitialClaimUser1 + balanceUser1).to.equal(thousand);
		expect(balanceWithoutInitialClaimUser2 + balanceUser2).to.equal(thousand);
		expect(balanceWithoutInitialClaimUser3 + balanceUser3).to.equal(thousand);

	});

	it('To be reverted by other claimer', async() => {
		const revertTx = teaVesting.connect(ownerVesting).claim(presaleTeaTokenA, user1);
		await expect(revertTx).to.be.reverted;
	})

	it('To claim tokenA', async() => {
		const balanceOfTeaBefore = await teaToken.balanceOf(user1);
		const claimBefore = await teaVesting.getVestingUsers(user1, presaleTeaTokenA);

		await teaVesting.connect(user1).claim(presaleTeaTokenA, user1);

		const balanceOfTeaAfter = await teaToken.balanceOf(user1);
		const claimAfter = await teaVesting.getVestingUsers(user1, presaleTeaTokenA);

		expect(balanceOfTeaAfter).to.gt(balanceOfTeaBefore);
		expect(claimAfter[1]).to.gt(claimBefore[1]);
	})

	it('Transfer ownership to other', async()=>{
		let owner = await teaVesting.getVestingOwners(user1, presaleTeaTokenA);
		expect(owner).to.equal(ethers.ZeroAddress);

		await teaVesting.connect(user1).transferOwnerOnChain(presaleTeaTokenA, user1, ownerVesting);
		const revertTx = teaVesting.connect(user1).transferOwnerOnChain(presaleTeaTokenA, user1, ownerVesting);
		await expect(revertTx).to.be.reverted;

		owner = await teaVesting.getVestingOwners(user1, presaleTeaTokenA);
		expect(owner).to.equal(ownerVesting.address);
	});

	it('Try to claim and vest after transfer ownership', async() => {
		await presaleTeaTokenA.connect(deployer).transfer(user1, thousand);
	  await presaleTeaTokenA.connect(user1).approve(teaVesting, thousand);

		const revertVest = teaVesting.vest(presaleTeaTokenA, thousand);
		const revertClaim = teaVesting.claim(presaleTeaTokenA, user1);

		expect(revertVest).to.be.reverted;
		expect(revertClaim).to.be.reverted;
	});

	it('Try to claim by ownership', async() => {
		const claimBefore = await teaVesting.getVestingUsers(user1, presaleTeaTokenA);
		const userBalanceBefore = await teaToken.balanceOf(user1);

		await teaVesting.connect(ownerVesting).claim(presaleTeaTokenA, user1);

		const claimAfter = await teaVesting.getVestingUsers(user1, presaleTeaTokenA);
		const userBalanceAfter = await teaToken.balanceOf(user1);

		expect(claimBefore[1]).to.lt(claimAfter[1]);
		expect(userBalanceBefore).to.lt(userBalanceAfter);
	});

	it('Return ownership to user1', async()=>{
		await teaVesting.connect(ownerVesting).transferOwnerOnChain(presaleTeaTokenA, user1, ownerVesting);
		const owner = await teaVesting.getVestingOwners(user1, presaleTeaTokenA);
		expect(owner).to.equal(ethers.ZeroAddress);
	});

	it('Try to claim after returned ownership', async() => {
		const claimBefore = await teaVesting.getVestingUsers(user1, presaleTeaTokenA);
		const userBalanceBefore = await teaToken.balanceOf(user1);

		await teaVesting.connect(user1).claim(presaleTeaTokenA, user1);

		const claimAfter = await teaVesting.getVestingUsers(user1, presaleTeaTokenA);
		const userBalanceAfter = await teaToken.balanceOf(user1);

		expect(claimBefore[0]).to.equal(claimAfter[0]);
		expect(claimBefore[1]).to.lt(claimAfter[1]);
		expect(userBalanceBefore).to.lt(userBalanceAfter);
	});

	it('Try to vest second time after returned ownership', async() => {
		const vestBefore = await teaVesting.getVestingUsers(user1, presaleTeaTokenA);
		const userBalanceBefore = await teaToken.balanceOf(user1);

		await teaVesting.connect(user1).vest(presaleTeaTokenA, thousand);

		const vestAfter = await teaVesting.getVestingUsers(user1, presaleTeaTokenA);
		const userBalanceAfter = await teaToken.balanceOf(user1);

		expect(vestBefore[0]).to.lt(vestAfter[0]);
		expect(vestBefore[1]).to.lt(vestAfter[1]);
		expect(userBalanceBefore).to.lt(userBalanceAfter);
	});

	it('Claim token B in middle of vesting and in end', async () => {
		await increaseTimestamp(ONE_MONTH / 2);
		let balanceBeforeClaim = await teaToken.balanceOf(user2);

		let unlockReward = await teaVesting.getUserUnlockReward(presaleTeaTokenB, user2);
		await increaseTimestamp(1);
		let unlockRewardAfterSec = await teaVesting.getUserUnlockReward(presaleTeaTokenB, user2);

		const tokenPerSec = unlockRewardAfterSec - unlockReward;

		await teaVesting.connect(user2).claim(presaleTeaTokenB, user2);

		let claim = await teaVesting.getVestingUsers(user2, presaleTeaTokenB);
		let balance = await teaToken.balanceOf(user2);


		expect(balanceBeforeClaim + unlockReward + (tokenPerSec * 2n)).to.equal(balance);
		expect(balance).to.equal(claim[1] + (thousand * INITIAL_PERCENT[1] / 1000n));

		await increaseTimestamp((ONE_MONTH / 2) - 100);
		await teaVesting.connect(user2).claim(presaleTeaTokenB, user2);
		claim = await teaVesting.getVestingUsers(user2, presaleTeaTokenB);
		balance = await teaToken.balanceOf(user2);

		expect(balance).to.equal(claim[1] + (thousand * INITIAL_PERCENT[1] / 1000n));

		await increaseTimestamp(100);
		await teaVesting.connect(user2).claim(presaleTeaTokenB, user2);
		claim = await teaVesting.getVestingUsers(user2, presaleTeaTokenB);
		balance = await teaToken.balanceOf(user2);
		
		expect(balance).to.equal(claim[1] + (thousand * INITIAL_PERCENT[1] / 1000n));
		expect(balance).to.equal(thousand);
	});


	it('Claim token C in the end and test getUserUnlockReward', async () => {
		const [
			claimBefore,
			unlockedRewardBefore,
			balanceBefore
		] = await Promise.all([
			teaVesting.getVestingUsers(user3, presaleTeaTokenC),
			teaVesting.getUserUnlockReward(presaleTeaTokenC, user3),
			teaToken.balanceOf(user3),
		]);

		await teaVesting.connect(user3).claim(presaleTeaTokenC, user3);
		await teaVesting.getVestingUsers(user3, presaleTeaTokenC);
		let unlockedRewardAfter = await teaVesting.getUserUnlockReward(presaleTeaTokenC, user3);
		let balance = await teaToken.balanceOf(user3);

		expect(
			(claimBefore[1] + unlockedRewardBefore) + 
			(thousand * INITIAL_PERCENT[2] / 1000n))
			.to.equal(thousand);
		expect(balanceBefore + unlockedRewardBefore).to.equal(balance);
		expect(unlockedRewardAfter).to.equal(0);

	});

	it('Nothing to claim revert', async() => {
		const revertTx = teaVesting.connect(user3).claim(presaleTeaTokenC, user3);
		await expect(revertTx).to.be.reverted;
	});

	it('Transfer ownership via off-chain', async () => {
		const sigExpired = await getSignatureOffChainOwnership(
			teaVesting,
			user1,
			user2,
			presaleTeaTokenC,
			2, // user3 accountIndex in mnemonic
		);

		const sigInvalid = await getSignatureOffChainOwnership(
			teaVesting,
			user1,
			user2,
			presaleTeaTokenC,
			2, // user3 accountIndex in mnemonic
		);
		sigInvalid.from = user4.address;
	
		const revertedInvalidSig = teaVesting.connect(user1).transferOwnerOffChain(sigInvalid);
		await expect(revertedInvalidSig).to.be.revertedWithCustomError(teaVesting, 'SignatureInvalid');

		await increaseTimestamp(ONE_MONTH);

		const revertedExpiredSig = teaVesting.connect(user1).transferOwnerOffChain(sigExpired);
		await expect(revertedExpiredSig).to.be.reverted;


		const sig = await getSignatureOffChainOwnership(
			teaVesting,
			user1,
			ownerVesting,
			presaleTeaTokenC,
			2, // user3 accountIndex in mnemonic
		);
		await teaVesting.connect(ownerVesting).transferOwnerOffChain(sig);
		const ownerOfUser1 = await teaVesting.getVestingOwners(user1, presaleTeaTokenC)
		expect(ownerOfUser1).to.equal(ownerVesting.address);
	})

	it('User cannot vest or claim after transferd ownership', async() => {
		await Promise.all([
			presaleTeaTokenB.connect(deployer).transfer(user1, thousand),
			presaleTeaTokenB.connect(user2).approve(teaVesting, thousand)
		]);
		const revertVest = teaVesting.connect(user2).vest(presaleTeaTokenB, thousand);
		const revertClaim = teaVesting.connect(user2).claim(presaleTeaTokenB, user2);

		expect(revertVest).to.be.reverted;
		expect(revertClaim).to.be.reverted;
	})

	it('Try to transfer ownership via off-chain and onChain should be reverted', async () => {
		const sig = await getSignatureOffChainOwnership(
			teaVesting,
			user1,
			user2,
			presaleTeaTokenC,
			2, // user3 accountIndex in mnemonic
		);
		const revertTxOffChain = teaVesting.connect(user2).transferOwnerOffChain(sig);
		const revertTxOnChain = teaVesting.connect(user1).transferOwnerOnChain(presaleTeaTokenC, user1, user2);

		await expect(revertTxOffChain).to.be.reverted;
		await expect(revertTxOnChain).to.be.reverted;
	})


	it('Try to transfer ownership via off-chain and onChain should be reverted', async () => {
		await Promise.all([
			presaleTeaTokenA.connect(deployer).transfer(user4, thousand),
			presaleTeaTokenA.connect(user4).approve(teaVesting, thousand)
		]);
		await teaVesting.connect(user4).vest(presaleTeaTokenA, thousand);
		const balanceUser4 = await teaToken.balanceOf(user4);

		const revertedClaim = teaVesting.connect(user4).claim(presaleTeaTokenA, user4);

		await expect(revertedClaim).to.be.reverted;
		expect(balanceUser4).to.equal(thousand);
	})

	it('Test forceTransfer', async() => {
		await presaleTeaTokenA.connect(deployer).transfer(teaVesting, thousand);
		const balanceBefore = await presaleTeaTokenA.balanceOf(deployer);

		await teaVesting.connect(ownerVesting).forceTransfer(presaleTeaTokenA, deployer, thousand);

		const balanceAfter = await presaleTeaTokenA.balanceOf(deployer);
		expect(balanceBefore + thousand).to.equal(balanceAfter);
	})
});

describe('TeaVesting', () => {
	let teaVesting: TeaVesting
  	let teaToken: TestERC20;
	let presaleTeaTokenA: TestERC20;
	let presaleTeaTokenB: TestERC20;
	let presaleTeaTokenC: TestERC20;
 	let user1: HardhatEthersSigner;
  	let user2: HardhatEthersSigner;
  	let user3: HardhatEthersSigner;
	let user4: HardhatEthersSigner;
	let ownerVesting: HardhatEthersSigner;
  	let treasury: HardhatEthersSigner;
  	let deployer: HardhatEthersSigner;
  	let accounts: HardhatEthersSigner[];
	let thousand = ethers.parseEther('1000');
	let million = ethers.parseEther('1000000');
	let threeMillion = ethers.parseEther('3000000');
	let ONE_MONTH = 2629800;
	let INITIAL_PERCENT = [100n, 200n, 500n]; // [10%, 20%, 50%];
	let currentTimestamp: BigNumberish;
	let nextMonth: BigNumberish;

it('Setup core contract: should revert ZTVB case (Zero Time Value Bypass)', async () => {
    [
			user1,
			user2,
			user3,
			user4,
			ownerVesting,
			treasury,
			deployer,
			...accounts
		] = await ethers.getSigners();

		presaleTeaTokenA = await new TestERC20__factory(deployer).deploy(million);
		presaleTeaTokenB = await new TestERC20__factory(deployer).deploy(million);
		presaleTeaTokenC = await new TestERC20__factory(deployer).deploy(million);
		teaToken = await new TestERC20__factory(deployer).deploy(threeMillion);

		currentTimestamp = getCurrentTimestamp() + 100;
		nextMonth = currentTimestamp + ONE_MONTH;
		const revertTx = new TeaVesting__factory(deployer).deploy(
			'TeaVesting', 																						// _name 
			ownerVesting.address, 																				// _initialOwner
			teaToken, 																							// _tea
			treasury, 																							// _treasury
			deployer, 																							// _trustedForwarder
			[presaleTeaTokenA, presaleTeaTokenB, presaleTeaTokenC], 											// _tokenAddrs
			[0n, 0n, 0n], 																						// _dataStarts
			[0n, 0n, 0n], 																						// _dataEnds
			INITIAL_PERCENT 																					// _percentUnlocks 10% = 100
		);
		await expect(revertTx).to.be.reverted;
  });
});

