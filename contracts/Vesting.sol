// SPDX-License-Identifier: MIT
pragma solidity =0.8.23;

import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

import {IVesting} from "./interface/IVesting.sol";

contract Vesting is IVesting, Ownable, ReentrancyGuard, ERC2771Context, EIP712, Nonces {
    using SafeERC20 for IERC20;
    // ------------------------------------------ Variabels ---------------------------------------
    mapping(address => mapping(address => UserVesting)) public getVestingUsers; //userWallet => presaleToken => UserVesting
    mapping(address => mapping(address => address)) public getVestingOwners; // userWallet => presaleToken => sideOwner
    mapping(address => VestingOption) public getVestingTokens; // presaleToken => VestingOption
    
    address public immutable tea;
    address public immutable treasury;

    bytes32 public constant TRANSFER_OWNER_TYPEHASH = 
        keccak256("TransferOwnerOffChain(address token,address from,address to,uint256 nonce,uint256 deadline)");
    address internal constant ZERO_ADDRESS = address(0);

    // ------------------------------------------ Constructor -------------------------------------
    
    /**
     * @dev Constructor
     * @param _name - See {EIP712}
     * @param initialOwner - Initial owner of the contract
     * @param _tea - Address of the TEA token
     * @param _treasury - Address of the treasury
     * @param _trustedForwarder - See {ERC2771}
     * @param tokenAddrs - Array of the presale token addresses for each tier
     * @param dataStarts - Array of the start date of the vesting for each tier
     * @param dataEnds - Array of the end date of the vesting for each tier
     * @param percentUnlocks - Array of the percent of the unlock for each tier
     */
    constructor(
        string memory _name,
        address initialOwner,
        address _tea,
        address _treasury, 
        address _trustedForwarder,
        address[] memory tokenAddrs,
        uint256[] memory dataStarts,
        uint256[] memory dataEnds,
        uint256[] memory percentUnlocks
    ) Ownable(initialOwner) EIP712(_name, "1") ERC2771Context(_trustedForwarder) {
        if (_tea == ZERO_ADDRESS || _treasury == ZERO_ADDRESS) {
            revert ZeroAddress();
        }

        tea = _tea;
        treasury = _treasury;

        uint256 teaDecimal = IERC20Metadata(_tea).decimals();
        uint256 len = tokenAddrs.length;

        if (dataStarts.length != len || 
            dataEnds.length != len || 
            percentUnlocks.length != len
        ) {
            revert WrongTokenConfig();
        }
        for(uint256 i=0; i<len; i++){
            if (tokenAddrs[i] == ZERO_ADDRESS) {
                revert ZeroAddress();
            }
            if(IERC20Metadata(tokenAddrs[i]).decimals() != teaDecimal) {
                revert WrongTokenConfig();
            }
            if(percentUnlocks[i] >= 1000) {
                revert WrongTokenConfig();
            }
            if(dataStarts[i] >= dataEnds[i]) {
                revert WrongTokenConfig();
            }

            getVestingTokens[tokenAddrs[i]] = VestingOption({
                dateEnd: dataEnds[i],
                dateStart: dataStarts[i],
                dateDuration: dataEnds[i] - dataStarts[i],
                percentUnlock: percentUnlocks[i]
            });
        }
    }

    // ------------------------------------------ Modifiers ---------------------------------------
    
    /**
     * @dev Modifier to check if the token address setted in constructor
     * @param token - Address of the token
     */
    modifier isValidTokenAddr(address token) {
        require(
            getVestingTokens[token].dateEnd != 0,
            "Vesting: INVALID_TOKEN_ADDRESS"
        );
        _;
    }

    /**
     * @dev Modifier to check if the address is valid
     * @param addr - Address to check
     */
    modifier isNonZeroAddress(address addr) {
        if (addr == ZERO_ADDRESS) {
            revert ZeroAddress();
        }
        _;
    }

    // ------------------------------------------ External functions ------------------------------    
    
    /**
     * @notice Claim the vested tokens
     * @param tokenAddr - Address of the presale token
     * @param userAddr - Address of the user
     */
    function  claim(address tokenAddr, address userAddr) 
        external 
        isValidTokenAddr(tokenAddr)
        isNonZeroAddress(userAddr)
        nonReentrant
    {
        address vestingOwner = getVestingOwners[userAddr][tokenAddr];
        address signer = _msgSender();
        if (userAddr != signer) {
            if (vestingOwner != signer) {
                revert OnlyVestingOwner();
            }
        } else {
            if (vestingOwner != ZERO_ADDRESS) {
                revert OnlyVestingOwner();
            }
        }
    
        VestingOption memory vestConfig = getVestingTokens[tokenAddr];
        UserVesting memory userVesting = getVestingUsers[userAddr][tokenAddr];
        uint256 currentTime = block.timestamp;

        if (userVesting.tokensForVesting == 0) {
            revert UserIsNotExist();
        }

        if (vestConfig.dateEnd <= currentTime) {
            uint256 reminder = userVesting.tokensForVesting - userVesting.totalVestingClaimed;
            _updateUserVesting(
                tokenAddr,
                userAddr,
                0,
                reminder
            );
            _claim(
                tokenAddr,
                userAddr,
                reminder
            );
            return;
        }

        uint256 elapsedTime = currentTime - vestConfig.dateStart;
        uint256 vestingUnlock = elapsedTime * userVesting.tokensForVesting 
                / vestConfig.dateDuration 
                - userVesting.totalVestingClaimed;              

        _updateUserVesting(
            tokenAddr,
            userAddr,
            0,
            vestingUnlock
        );
        _claim(
            tokenAddr,
            userAddr,
            vestingUnlock
        );
    }

    /**
     * @notice Initiate or add more vesting
     * @param tokenAddr - Address of the presale token
     * @param tokenAmount - Amount of the presale token to be vested
     */
    function vest(
        address tokenAddr,
        uint256 tokenAmount
    ) external isValidTokenAddr(tokenAddr) nonReentrant {
        VestingOption memory vestConfig = getVestingTokens[tokenAddr];
        address userAddr = _msgSender();

        address vestingOwner = getVestingOwners[userAddr][tokenAddr];
        uint256 currentTime = block.timestamp;

        if (tokenAmount <= 0) {
            revert ZeroAmount();
        }
        if(vestingOwner != ZERO_ADDRESS) {
            revert VestingDisabledForYou();
        }
        if(vestConfig.dateStart > currentTime) {
            revert VestingDoesNotStart();
        }

        uint256 initialUnlock = tokenAmount * vestConfig.percentUnlock / 1000;
        uint256 tokenLeftAfterUnlock = tokenAmount - initialUnlock;

        if (vestConfig.dateEnd <= currentTime) { 
            _updateUserVesting(
                tokenAddr,
                userAddr,
                tokenAmount,
                tokenAmount
            );
            _vest(
                tokenAddr,
                userAddr,
                tokenAmount,
                initialUnlock, 
                tokenLeftAfterUnlock 
            );
            return;
        }

        uint256 elapsedTime = currentTime - vestConfig.dateStart;
        uint256 vestingUnlock = elapsedTime * tokenLeftAfterUnlock 
            / vestConfig.dateDuration; 

        _updateUserVesting(
            tokenAddr,
            userAddr,
            tokenLeftAfterUnlock, 
            vestingUnlock 
        );
        _vest(
            tokenAddr,
            userAddr,
            tokenAmount,
            initialUnlock,
            vestingUnlock 
        );
    }

    /**
     * @notice Transfer ownership of the user vesting
     * @param tokenAddr - Address of the presale token
     * @param from - Address of the previous owner
     * @param owner_ - Address of the new owner
     */
    function transferOwnerOnChain(
        address tokenAddr,
        address from,
        address owner_
    ) 
        external 
        isValidTokenAddr(tokenAddr)
    {
        address signer = _msgSender();
        address vestingOwner = getVestingOwners[from][tokenAddr];
        if (signer == vestingOwner) { 
            _transferOwnerShip(tokenAddr, from, ZERO_ADDRESS);
            return;
        }
        if (signer != from || vestingOwner != ZERO_ADDRESS) {
            revert OnlyVestingOwner();
        }
        _transferOwnerShip(tokenAddr, from, owner_);
    }

    /**
     * @notice Transfer ownership of the user vesting off-chain
     * @param _offChainStruct - OffChainStruct struct
     */
    function transferOwnerOffChain(OffChainStruct calldata _offChainStruct)
        external
        isValidTokenAddr(_offChainStruct.token) 
    {
        if (getVestingOwners[_offChainStruct.from][_offChainStruct.token] 
            != ZERO_ADDRESS
        ) {
            revert OnlyVestingOwner();
        }

        if (_offChainStruct.deadline < block.timestamp) {
            revert SignatureExpired();
        }

        if (!_verify(_offChainStruct)) {
            revert SignatureInvalid();
        }

        _transferOwnerShip(
            _offChainStruct.token,
            _offChainStruct.from,
            _offChainStruct.to
        );
    }

    /**
     * @notice forceTransfer need to have when user accidentally transfer tokens to contract;
     * @param tokenAddr - token address;
     * @param to - receiver tokens;
     * @param amount - token amounts;
     */
    function forceTransfer(address tokenAddr, address to, uint256 amount) 
        external
        onlyOwner 
    {
        IERC20(tokenAddr).safeTransfer(to, amount);
    }


    // ------------------------------------------ Public/External view functions ---------------------------
    function getUserUnlockReward(
        address tokenAddr,
        address userAddr
    ) public view returns(uint256) {
        VestingOption memory vestConfig = getVestingTokens[tokenAddr];
        UserVesting memory userVesting = getVestingUsers[userAddr][tokenAddr];
        uint256 currentTime = block.timestamp;
        if (currentTime >= vestConfig.dateEnd) {
            return userVesting.tokensForVesting - userVesting.totalVestingClaimed;
        }
        uint256 elapsedTime = currentTime - vestConfig.dateStart;
        return elapsedTime * userVesting.tokensForVesting 
            / vestConfig.dateDuration 
            - userVesting.totalVestingClaimed;  
    }

    /**
     * @notice Hashes the struct data, see [eip712 docs](https://eips.ethereum.org/EIPS/eip-712)
     * @param structHash - Hash of the struct
     */
    function hashTypedDataV4(bytes32 structHash) external view returns (bytes32) {
        return super._hashTypedDataV4(structHash);
    }


    // ------------------------------------------ Internal functions ------------------------------  
    /**
     * @notice Overrides the function from inherited smart-contracts: `Context`, `ERC2771Context`
     * @dev The requirement from the ERC2771Recipient, see [gsn docs](https://docs.opengsn.org/contracts/#receiving-a-relayed-call)
     */
    function _msgSender() internal view virtual override(Context, ERC2771Context) returns (address) {
        return super._msgSender();
    }

    /**
     * @notice Overrides the function from inherited smart-contracts: `Context`, `ERC2771Context`
     * @dev The requirement from the ERC2771Recipient, see [gsn docs](https://docs.opengsn.org/contracts/#receiving-a-relayed-call)
     */
    function _msgData() internal view virtual override(Context, ERC2771Context) returns (bytes calldata) {
        return super._msgData();
    }

    /**
     * @notice Overrides the function from inherited smart-contracts: `Context`, `ERC2771Context`
     * @dev The requirement from the ERC2771Context, see [gsn docs](https://docs.opengsn.org/contracts/#receiving-a-relayed-call)
     */
    function _contextSuffixLength() internal view virtual override(Context, ERC2771Context) returns (uint256) {
        return super._contextSuffixLength();
    }

    /**
     * @notice Transfer ownership of the user vesting
     * @param tokenAddr - Address of the presale token
     * @param from - Address of the previous owner
     * @param owner_ - Address of the new owner
     */
    function _transferOwnerShip(
        address tokenAddr,
        address from,
        address owner_
    ) internal {
        getVestingOwners[from][tokenAddr] = owner_;
        emit TransferOwner(tokenAddr, from, owner_);
    }

    /**
     * @notice Update user vesting
     * @param tokenAddr - Address of the presale token
     * @param userAddr - Address of the user
     * @param tokensForVesting - Amount of the tokens to be vested
     * @param vestingClaimed - Amount of the claimed vesting
     */
    function  _updateUserVesting(
        address tokenAddr,
        address userAddr,
        uint256 tokensForVesting,
        uint256 vestingClaimed
    ) internal {
        UserVesting storage user = getVestingUsers[userAddr][tokenAddr];
        unchecked {
            user.tokensForVesting += tokensForVesting;
            user.totalVestingClaimed += vestingClaimed;
        }
    }

    /**
     * @notice Vest the presale tokens
     * @param tokenAddr - Address of the presale token
     * @param userAddr - Address of the user
     * @param amountToBurn - Amount of the presale token to be locked
     * @param initialUnlock - Amount of the presale token to be unlocked initially
     * @param vestedUnlock - Amount of the presale token to be unlocked now since vesting started
     */
    function _vest(
        address tokenAddr,
        address userAddr,
        uint256 amountToBurn,
        uint256 initialUnlock,
        uint256 vestedUnlock
    ) internal {
        IERC20(tokenAddr).safeTransferFrom(userAddr, address(this), amountToBurn); 
        IERC20(tea).safeTransferFrom(treasury, userAddr, vestedUnlock + initialUnlock);
        emit Vest(tokenAddr, userAddr, amountToBurn, initialUnlock, vestedUnlock);
    }

    /**
     * @notice Claim the vested tokens
     * @param tokenAddr - Address of the presale token
     * @param userAddr - Address of the user
     * @param amountToUnlock - Amount of the presale token to be unlocked
     */
    function _claim(
        address tokenAddr,
        address userAddr,
        uint256 amountToUnlock
    ) internal {
        if (amountToUnlock == 0) {
            revert VestingNothingToClaim();
        }
        IERC20(tea).safeTransferFrom(treasury, userAddr, amountToUnlock);
        emit Claim(tokenAddr, userAddr, amountToUnlock);
    }

    /**
     * @notice Verify the signature
     * @param _offChainStruct - OffChainStruct struct
     */
    function _verify(OffChainStruct calldata _offChainStruct) internal returns(bool){
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_OWNER_TYPEHASH,
                _offChainStruct.token,
                _offChainStruct.from,
                _offChainStruct.to,
                _useNonce(_offChainStruct.from),
                _offChainStruct.deadline
            )
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        address recoveredAddress = ECDSA.recover(
            hash,
            _offChainStruct.v,
            _offChainStruct.r,
            _offChainStruct.s
        );
        return recoveredAddress == _offChainStruct.from;
    }
}
